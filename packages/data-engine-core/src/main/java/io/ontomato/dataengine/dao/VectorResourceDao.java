package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
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

	public VectorResource insert(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		FileOutputStream fos = null;
		try {
			String indexName = generateIndexName(vectorResource.getClassName(), vectorResource.getAttrName(), domainId);

			// File storage
			File dir = new File("conf/" + dirName + "/" + indexName);
			dir.mkdirs();
			String id = UUID.randomUUID().toString();
			File file = new File(dir, id + "." + suffix);
			fos = new FileOutputStream(file);
			fos.write(is.readAllBytes());

			vectorResource.setId(id);
			vectorResource.setPath(indexName + "/" + id + "." + suffix);

			// Vector store storage
			ensureTable(indexName);

			String brief = vectorResource.getContent();
			String replaceBrief = this.replace(brief);
			for (String forbid : new String[] { "题材", "类型", "感觉", "风格" }) {
				replaceBrief.replace(forbid, "");
			}
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
			log.error(e.getMessage(), e);
			return null;
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
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
		file.toFile().delete();
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
		// 删目录下所有文件(不用递归)然后建目录
		log.info("<<<rebuild " + indexName + " vector dimension: " + dims);
	}
	
	public void truncateNamespace(String tmpNamespace, String domainId) {
//		"SELECT current_schema();"
//		String prefix = generateIndexNamePrefix(tmpNamespace);
//		for (query("SELECT table_name FROM information_schema.tables WHERE table_schema = '" + current_schema + "' AND table_type = 'BASE TABLE';")) {
//			if (tableName.startsWith(prefix) && tableName.endsWith("-" + domainId)) {
//				delete from table_name
//				删目录下所有文件(不用递归)
//			}
//		}
	}
	
	public void dropNamespace(String tmpNamespace, String domainId) {
//		"SELECT current_schema();"
//		String prefix = generateIndexNamePrefix(tmpNamespace);
//		for (query("SELECT table_name FROM information_schema.tables WHERE table_schema = '" + current_schema + "' AND table_type = 'BASE TABLE';")) {
//			if (tableName.startsWith(prefix) && tableName.endsWith("-" + domainId)) {
//				drop table table_name
//				删目录下所有文件(不用递归)和目录本身
//			}
//		}
	}

}
