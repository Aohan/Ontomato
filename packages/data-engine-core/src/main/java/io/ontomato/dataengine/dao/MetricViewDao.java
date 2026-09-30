package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.pgvector.PGvector;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.OriginCheckResult;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.util.AutoKMeansClusteringUtil;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("metricViewDao")
public class MetricViewDao extends BaseDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private AssetLookupPolicy assetLookupPolicy;

	@Autowired
	private EmbeddingService embeddingService;

	private static final String TABLE_NAME = "metric_view";

	private static final String COLUMNS = "id, name, origin, type, function_id, description, status, match_questions, class_names, domain_id, create_timestamp, modify_timestamp, origin_check_result, origin_question";

	@PostConstruct
	public void initIndex() {
		try {
			jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector");
		} catch (Exception e) {
			log.warn(">>>Cannot create pgvector extension: {}", e.getMessage());
		}
		jdbcTemplate.execute(
				"CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
						+ "id VARCHAR(64) PRIMARY KEY, "
						+ "name VARCHAR(255), "
						+ "origin VARCHAR(32), "
						+ "type VARCHAR(32), "
						+ "function_id VARCHAR(64), "
						+ "description TEXT, "
						+ "status VARCHAR(64), "
						+ "match_questions TEXT, "
						+ "class_names TEXT, "
						+ "domain_id VARCHAR(64), "
						+ "create_timestamp BIGINT, "
						+ "modify_timestamp BIGINT, "
						+ "origin_check_result TEXT, "
						+ "origin_question TEXT, "
						+ "brief TEXT, "
						+ "brief_vector vector(" + embeddingModelProperties.getDimensions() + ")"
						+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
	}

	public MetricView save(MetricView metricView) {
		if (metricView.getId() == null) {
			metricView.setId(UUID.randomUUID().toString());
		}
		Long now = System.currentTimeMillis();
		if (metricView.getCreateTimestamp() == null) {
			metricView.setCreateTimestamp(now);
		}
		metricView.setModifyTimestamp(now);
		Function function = metricView.getFunction();
		String domainId = function.getDomainId();

		String classNamesStr = buildClassNamesStr(function);
		String brief = buildBrief(metricView);

		Response<Embedding> embeddingResponse = embeddingService.embedding(brief, function.getDomainId());
		float[] embededVector = embeddingResponse.content().vector();
		PGvector pgVector = new PGvector(embededVector);

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ", brief, brief_vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::vector) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, origin = EXCLUDED.origin, type = EXCLUDED.type, "
						+ "function_id = EXCLUDED.function_id, description = EXCLUDED.description, status = EXCLUDED.status, "
						+ "match_questions = EXCLUDED.match_questions, class_names = EXCLUDED.class_names, "
						+ "domain_id = EXCLUDED.domain_id, create_timestamp = EXCLUDED.create_timestamp, "
						+ "modify_timestamp = EXCLUDED.modify_timestamp, origin_check_result = EXCLUDED.origin_check_result, "
						+ "origin_question = EXCLUDED.origin_question, brief = EXCLUDED.brief, brief_vector = EXCLUDED.brief_vector",
				metricView.getId(), metricView.getName(), metricView.getOrigin(), metricView.getType(),
				function.getId(), metricView.getDescription(), metricView.getStatus(),
				JSON.toJSONString(metricView.getMatchQuestions(), Feature.WriteMapNullValue),
				classNamesStr, metricView.getDomainId(), metricView.getCreateTimestamp(), metricView.getModifyTimestamp(),
				metricView.getOriginCheckResult() == null ? null : JSON.toJSONString(metricView.getOriginCheckResult(), Feature.WriteMapNullValue),
				metricView.getOriginQuestion(), brief, pgVector);
		return metricView;
	}

	private String buildClassNamesStr(Function function) {
		Set<String> classNames = new HashSet<String>();
		if (function != null) {
			List<Parameter> parameters = function.getParameters();
			if (parameters != null) {
				for (Parameter parameter : parameters) {
					if (parameter.getClassNames() != null && parameter.getClassNames().size() > 0) {
						classNames.addAll(parameter.getClassNames());
					}
				}
			}
			if (function.getReturnDef() != null && function.getReturnDef().getClassNames() != null) {
				classNames.addAll(function.getReturnDef().getClassNames());
			}
		}
		StringBuilder sb = new StringBuilder(",");
		for (String className : classNames) {
			sb.append(className).append(",");
		}
		return sb.toString();
	}

	private String buildBrief(MetricView metricView) {
		StringBuilder brief = new StringBuilder();
		brief.append(metricView.getName()).append("\n");
		if (metricView.getDescription() != null) {
			brief.append(metricView.getDescription()).append("\n");
		}
		if (metricView.getMatchQuestions() != null) {
			for (String q : metricView.getMatchQuestions()) {
				brief.append(q).append("\n");
			}
		}
		return brief.toString();
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ?", id);
	}

	public Object[] queryById(String id) {
		if (!assetLookupPolicy.shouldQuery(jdbcTemplate, TABLE_NAME)) {
			return null;
		}
		MetricView metricView = null;
		String functionId = null;
		try {
			List<Object[]> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ?",
					(rs, rowNum) -> mapRowWithFunctionId(rs), id);
			if (!list.isEmpty()) {
				Object[] row = list.get(0);
				metricView = (MetricView) row[0];
				functionId = (String) row[1];
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		if (metricView == null) {
			return null;
		} else {
			return new Object[] { metricView, functionId };
		}
	}

	public List<Object[]> queryList(String type, String status, String functionId, String className, String domainId) {
		List<Object[]> oList = new ArrayList<Object[]>();
		if (!assetLookupPolicy.shouldQuery(jdbcTemplate, TABLE_NAME)) {
			return oList;
		}
		try {
			StringBuilder whereSql = new StringBuilder("1 = 1");
			List<Object> params = new ArrayList<>();
			if (type != null && !"".equals(type.trim())) {
				whereSql.append(" AND type = ?");
				params.add(type.trim());
			}
			if (status != null && !"".equals(status.trim())) {
				whereSql.append(" AND status = ?");
				params.add(status.trim());
			}
			if (functionId != null && !"".equals(functionId.trim())) {
				whereSql.append(" AND function_id = ?");
				params.add(functionId.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			oList = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql + " ORDER BY modify_timestamp DESC",
					(rs, rowNum) -> mapRowWithFunctionId(rs), params.toArray());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return oList;
	}

	public List<Object[]> find(String question, String type, String className, int maxResult, double minScore, String domainId) {
		List<Object[]> oList = new ArrayList<Object[]>();
		try {
			Response<Embedding> embeddingResponse = embeddingService.embedding(question, domainId);
			float[] findVector = embeddingResponse.content().vector();
			PGvector pgVector = new PGvector(findVector);

			StringBuilder whereSql = new StringBuilder("status = ?");
			List<Object> params = new ArrayList<>();
			params.add(MetricView.STATUS_PUBLISHED);
			if (type != null && !"".equals(type.trim())) {
				whereSql.append(" AND type = ?");
				params.add(type.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			String sql = "SELECT " + COLUMNS + ", brief_vector <-> ?::vector AS distance FROM " + TABLE_NAME
					+ " WHERE " + whereSql + " ORDER BY distance LIMIT ?";
			List<Object> queryParams = new ArrayList<>(params);
			queryParams.add(pgVector);
			queryParams.add(maxResult);

			List<Object[]> rows = jdbcTemplate.query(sql,
					(rs, rowNum) -> {
						Object[] row = mapRowWithFunctionId(rs);
						return new Object[] { row[0], row[1], rs.getDouble("distance") };
					}, queryParams.toArray());

			if (rows != null && !rows.isEmpty()) {
				double dMinScore = 0;
				if (minScore > 0) {
					dMinScore = minScore;
				} else {
					List<Double> listScores = new ArrayList<>();
					for (Object[] row : rows) {
						listScores.add(distanceToScore((Double) row[2]));
					}
					log.info("listScores:" + JSON.toJSONString(listScores));
					AutoKMeansClusteringUtil autoKMeansClusteringUtil = new AutoKMeansClusteringUtil(listScores);
					autoKMeansClusteringUtil.runAutoKMeans();
					dMinScore = autoKMeansClusteringUtil.getHighClustersMinX();
					log.info("dMinScore:" + dMinScore);
				}

				for (Object[] row : rows) {
					double dScore = distanceToScore((Double) row[2]);
					if (dScore >= dMinScore) {
						oList.add(new Object[] { row[0], row[1] });
					}
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return oList;
	}

	private Object[] mapRowWithFunctionId(java.sql.ResultSet rs) throws java.sql.SQLException {
		MetricView metricView = new MetricView();
		metricView.setId(rs.getString("id"));
		metricView.setName(rs.getString("name"));
		metricView.setOrigin(rs.getString("origin"));
		metricView.setType(rs.getString("type"));
		metricView.setDescription(rs.getString("description"));
		metricView.setStatus(rs.getString("status"));
		metricView.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		metricView.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		metricView.setDomainId(rs.getString("domain_id"));
		String matchQuestionsStr = rs.getString("match_questions");
		Set<String> matchQuestions = new HashSet<String>();
		if (matchQuestionsStr != null) {
			matchQuestions.addAll(JSONArray.parseArray(matchQuestionsStr, String.class));
		}
		metricView.setMatchQuestions(matchQuestions);
		String originCheckResultStr = rs.getString("origin_check_result");
		metricView.setOriginCheckResult(originCheckResultStr == null ? null : JSONObject.parseObject(originCheckResultStr, OriginCheckResult.class));
		metricView.setOriginQuestion(rs.getString("origin_question"));
		String functionId = rs.getString("function_id");
		return new Object[] { metricView, functionId };
	}

}
