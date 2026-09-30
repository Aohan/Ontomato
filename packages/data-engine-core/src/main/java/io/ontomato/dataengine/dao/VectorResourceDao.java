package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.pgvector.PGvector;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.util.AutoKMeansClusteringUtil;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("vectorResourceDao")
public class VectorResourceDao extends BaseDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private EmbeddingService embeddingService;

	private String dirName = "vectorResource";

	private String generateIndexNamePrefix(String tmpNamespace) {
		return "vector-" + tmpNamespace.replace("/", "_");
	}

	private String generateIndexName(String className, String attrName, String domainId) {
		return "vector-" + className.replace("/", "_") + "-" + attrName + "-" + domainId;
	}

	private String quotedTable(String indexName) {
		return "\"" + indexName + "\"";
	}

	private String replace(String brief) {
		String regex = "[\\+\\-\\=\\&\\|\\>\\<!\\(\\)\\{\\}\\[\\]\\^\\\\\\\"\\~\\*\\?\\:\\/\\s]";
		String replaceBrief = brief.replaceAll(regex, "");
		return replaceBrief;
	}

	private float[] briefToVector(String replaceBrief, String domainId) {
		Response<Embedding> embeddingResponse = embeddingService.embedding(replaceBrief, domainId);
		float[] embededVector = embeddingResponse.content().vector();
		return embededVector;
	}

	private void ensureTable(String indexName) {
		jdbcTemplate.execute(
				"CREATE TABLE IF NOT EXISTS " + quotedTable(indexName) + " ("
						+ "id VARCHAR(64) PRIMARY KEY, "
						+ "brief TEXT, "
						+ "path VARCHAR(512), "
						+ "class_name VARCHAR(256), "
						+ "attr_name VARCHAR(256), "
						+ "object_id VARCHAR(256), "
						+ "brief_vector vector(" + embeddingModelProperties.getDimensions() + ")"
						+ ")");
	}

	/**
	 * Ensure the vector table and its file directory exist (idempotent).
	 *
	 * <p>Used by the sandbox {@code createClass} to materialize the vector table and directory as an
	 * explicit step, symmetric with {@link #dropNamespace}. Also the single place that backs the lazy
	 * creation inside {@link #insert}, so the two callers share one idempotent rule.</p>
	 */
	public void ensureVectorTable(String className, String attrName, String domainId) {
		String indexName = generateIndexName(className, attrName, domainId);
		new File("conf/" + dirName + "/" + indexName).mkdirs();
		ensureTable(indexName);
	}

	public VectorResource insert(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		if (vectorResource.getContent() == null || vectorResource.getContent().trim().isEmpty()) {
			throw new IllegalArgumentException("content is required");
		}
		if (is != null) {
			if (suffix == null || !suffix.matches("^[a-zA-Z0-9]{1,16}$")) {
				throw new IllegalArgumentException("Invalid suffix: must be 1-16 alphanumeric characters");
			}
		} else {
			suffix = "txt";
		}

		String indexName = generateIndexName(vectorResource.getClassName(), vectorResource.getAttrName(), domainId);
		File dir = new File("conf/" + dirName + "/" + indexName);
		dir.mkdirs();
		String id = UUID.randomUUID().toString();
		File file = new File(dir, id + "." + suffix);

		try {
			try (FileOutputStream fos = new FileOutputStream(file)) {
				if (is != null) {
					fos.write(is.readAllBytes());
				} else {
					fos.write(vectorResource.getContent().getBytes(StandardCharsets.UTF_8));
				}
			}

			vectorResource.setId(id);
			vectorResource.setPath(indexName + "/" + id + "." + suffix);

			// Vector store storage
			ensureTable(indexName);

			String brief = vectorResource.getContent();
			String replaceBrief = this.replace(brief);
			float[] embededVector = this.briefToVector(replaceBrief, domainId);
			vectorResource.setContent(replaceBrief);
			PGvector pgVector = new PGvector(embededVector);

			jdbcTemplate.update(
					"INSERT INTO " + quotedTable(indexName) + " (id, brief, path, class_name, attr_name, object_id, brief_vector) "
							+ "VALUES (?, ?, ?, ?, ?, ?, ?::vector) "
							+ "ON CONFLICT (id) DO UPDATE SET brief = EXCLUDED.brief, path = EXCLUDED.path, "
							+ "class_name = EXCLUDED.class_name, attr_name = EXCLUDED.attr_name, "
							+ "object_id = EXCLUDED.object_id, brief_vector = EXCLUDED.brief_vector",
					vectorResource.getId(), vectorResource.getContent(), vectorResource.getPath(),
					vectorResource.getClassName(), vectorResource.getAttrName(), vectorResource.getObjectId(),
					pgVector);

			return vectorResource;
		} catch (Exception e) {
			if (file.exists()) {
				file.delete();
			}
			log.error(e.getMessage(), e);
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("Failed to insert vector resource: " + e.getMessage(), e);
		}
	}

	public List<VectorResource> find(String question, int maxResult, String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		String tableName = quotedTable(indexName);
		List<VectorResource> vectorResources = new ArrayList<VectorResource>();
		float[] findVector = null;
		String queryString = "";
		try {
			ensureTable(indexName);

			String replaceQuestion = this.replace(question);
			Response<Embedding> embeddingResponse = embeddingService.embedding(replaceQuestion, domainId);
			findVector = embeddingResponse.content().vector();

			queryString = "SELECT id, brief, path, class_name, attr_name, object_id, brief_vector <-> ?::vector AS distance FROM " + tableName
					+ " ORDER BY distance LIMIT ?";
			PGvector pgVector = new PGvector(findVector);

			List<Object[]> rows = jdbcTemplate.query(queryString,
					(rs, rowNum) -> new Object[] {
							rs.getString("id"),
							rs.getString("brief"),
							rs.getString("path"),
							rs.getString("class_name"),
							rs.getString("attr_name"),
							rs.getString("object_id"),
							rs.getDouble("distance")
					},
					pgVector, maxResult);

			if (rows != null && !rows.isEmpty()) {
				log.info("Hits:" + rows.size());
				List<Double> listScores = new ArrayList<>();
				for (Object[] row : rows) {
					double distance = (Double) row[6];
					double score = distanceToScore(distance);
					listScores.add(score);
				}
				log.info("listScores:" + JSON.toJSONString(listScores));
				AutoKMeansClusteringUtil autoKMeansClusteringUtil = new AutoKMeansClusteringUtil(listScores);
				autoKMeansClusteringUtil.runAutoKMeans();
				double dMinScore = autoKMeansClusteringUtil.getHighClustersMinX();
				log.info("dMinScore:" + dMinScore);

				for (Object[] row : rows) {
					double distance = (Double) row[6];
					double score = distanceToScore(distance);
					if (score >= dMinScore) {
						VectorResource vectorResource = new VectorResource();
						vectorResource.setId((String) row[0]);
						vectorResource.setContent((String) row[1]);
						vectorResource.setPath((String) row[2]);
						vectorResource.setClassName((String) row[3]);
						vectorResource.setAttrName((String) row[4]);
						vectorResource.setObjectId((String) row[5]);
						vectorResources.add(vectorResource);
					}
				}
			}
		} catch (Exception e) {
			if (findVector == null) {
				log.error("Exception:{},question:{},findVector length={},queryString:\n{}", e.getMessage(), question, 0, queryString);
			} else {
				log.error("Exception:{},question:{},findVector length={},queryString:\n{}", e.getMessage(), question, findVector.length, queryString);
			}
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("Vector search failed: " + e.getMessage(), e);
		}
		return vectorResources;
	}

	public int getResourceTotal(String className, String attrName, String domainId) {
		File dir = new File("conf/" + dirName + "/" + this.generateIndexName(className, attrName, domainId));
		if (dir.exists() && dir.isDirectory()) {
			return dir.list().length;
		} else {
			return 0;
		}
	}

	public File getFile(String indexName, String fileName) {
		return new File("conf/" + dirName + "/" + indexName + "/" + fileName);
	}

	/**
	 * Delete one vector resource of this domain's class attribute: its vector table record and its file.
	 *
	 * <p>The class, attribute and path come from the API caller. The index directory must be a direct child of
	 * the vector resource root and the path a direct file of that directory, recorded for the object;
	 * anything else is rejected before any record or file is touched.</p>
	 *
	 * @param path the stored relative path ({@code indexName/id.suffix}), matching {@link VectorResource#getPath()}
	 */
	public void delete(String className, String attrName, String objectId, String path, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		Path root = Paths.get("conf", dirName).toAbsolutePath();
		Path indexDir = root.resolve(indexName).normalize();
		Path file = root.resolve(path).normalize();
		if (!root.equals(indexDir.getParent()) || !indexDir.equals(file.getParent())) {
			throw new IllegalArgumentException("Vector resource path does not belong to " + indexName + ": " + path);
		}
		int deleted = jdbcTemplate.update("DELETE FROM " + quotedTable(indexName) + " WHERE object_id = ? AND path = ?", objectId, path);
		if (deleted == 0) {
			throw new IllegalArgumentException("Vector resource not found for object " + objectId + ": " + path);
		}
		if (!file.toFile().delete()) {
			throw new IllegalStateException("Failed to delete vector resource file: " + file.toAbsolutePath());
		}
	}

	public void rebuildIndex(String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		String tableName = quotedTable(indexName);

		log.info(">>>rebuild " + indexName);

		int dims = embeddingModelProperties.getDimensions();
		jdbcTemplate.execute("DROP TABLE IF EXISTS " + tableName);
		jdbcTemplate.execute("CREATE TABLE " + tableName + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "brief TEXT, "
				+ "path VARCHAR(512), "
				+ "class_name VARCHAR(256), "
				+ "attr_name VARCHAR(256), "
				+ "object_id VARCHAR(256), "
				+ "brief_vector vector(" + dims + ")"
				+ ")");
		deleteFilesInDirectory(indexName);
		new File("conf/" + dirName + "/" + indexName).mkdirs();
		log.info("<<<rebuild " + indexName + " vector dimension: " + dims);
	}
	
	/**
	 * Clear the data of every vector table belonging to this sandbox (prefix-matched by namespace and domain),
	 * keeping the tables and their file directories in place.
	 */
	public void truncateNamespace(String tmpNamespace, String domainId) {
		String prefix = generateIndexNamePrefix(tmpNamespace);
		for (String tableName : listVectorTables(prefix, domainId)) {
			jdbcTemplate.execute("DELETE FROM " + quotedTable(tableName));
			deleteFilesInDirectory(tableName);
		}
	}

	/**
	 * Drop every vector table of this sandbox (prefix-matched by namespace and domain) and delete their file
	 * directories entirely.
	 */
	public void dropNamespace(String tmpNamespace, String domainId) {
		String prefix = generateIndexNamePrefix(tmpNamespace);
		for (String tableName : listVectorTables(prefix, domainId)) {
			jdbcTemplate.execute("DROP TABLE IF EXISTS " + quotedTable(tableName));
			deleteFilesInDirectory(tableName);
			File dir = new File("conf/" + dirName + "/" + tableName);
			if (dir.isDirectory() && !dir.delete()) {
				log.warn("Failed to delete vector resource directory: {}", dir.getAbsolutePath());
			}
		}
	}

	/** Vector table names of the current schema matching the given prefix and ending with {@code -domainId}. */
	private List<String> listVectorTables(String prefix, String domainId) {
		String sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'";
		List<String> all = jdbcTemplate.queryForList(sql, String.class);
		List<String> matched = new ArrayList<>();
		for (String tableName : all) {
			if (tableName.startsWith(prefix) && tableName.endsWith("-" + domainId)) {
				matched.add(tableName);
			}
		}
		return matched;
	}

	/** Delete all files directly under a vector resource directory, keeping the directory itself. */
	private void deleteFilesInDirectory(String indexName) {
		File dir = new File("conf/" + dirName + "/" + indexName);
		if (!dir.isDirectory()) {
			return;
		}
		File[] files = dir.listFiles();
		if (files == null) {
			return;
		}
		for (File file : files) {
			if (file.isFile() && !file.delete()) {
				log.warn("Failed to delete vector resource file: {}", file.getAbsolutePath());
			}
		}
	}

	public void clear(String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		clearIndex(indexName);
	}

	public void clearByDomain(String domainId) {
		Set<String> indexNames = new HashSet<>();
		File rootDir = new File("conf/" + dirName);
		if (rootDir.exists() && rootDir.isDirectory()) {
			File[] dirs = rootDir.listFiles();
			if (dirs != null) {
				for (File dir : dirs) {
					if (dir.isDirectory() && dir.getName().startsWith("vector-") && dir.getName().endsWith("-" + domainId)) {
						indexNames.add(dir.getName());
					}
				}
			}
		}
		List<String> tables = jdbcTemplate.queryForList(
				"SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE ?",
				String.class,
				"vector-%-" + domainId);
		if (tables != null) {
			indexNames.addAll(tables);
		}
		for (String indexName : indexNames) {
			clearIndex(indexName);
		}
	}

	private void clearIndex(String indexName) {
		jdbcTemplate.execute("DROP TABLE IF EXISTS " + quotedTable(indexName));
		File dir = new File("conf/" + dirName + "/" + indexName);
		if (dir.exists()) {
			File[] files = dir.listFiles();
			if (files != null) {
				for (File f : files) {
					if (!f.delete()) {
						throw new IllegalStateException("Failed to delete vector resource file: " + f.getAbsolutePath());
					}
				}
			}
			if (!dir.delete()) {
				throw new IllegalStateException("Failed to delete vector resource directory: " + dir.getAbsolutePath());
			}
		}
	}

}
