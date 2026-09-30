package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.pgvector.PGvector;
import io.ontomato.dataengine.service.ai.EmbeddingService;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("businessExampleQuestionSpliterDao")
public class BusinessExampleQuestionSpliterDao extends BaseDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private EmbeddingService embeddingService;

	private static final String TABLE_NAME = "business_example_question_spliter";

	private static final String COLUMNS = "id, question, content, status, create_timestamp, modify_timestamp, domain_id";

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
						+ "question TEXT, "
						+ "content TEXT, "
						+ "status INTEGER DEFAULT 0, "
						+ "create_timestamp BIGINT, "
						+ "modify_timestamp BIGINT, "
						+ "domain_id VARCHAR(64), "
						+ "example_vector vector(" + embeddingModelProperties.getDimensions() + ")"
						+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
	}

	public void insertBussinessExample(BusinessExampleQuestionSpliterEntity bussinessExampleEntity, String domainId) {
		String exampleID = bussinessExampleEntity.getId();
		StringBuilder sbBussinessExampleText = new StringBuilder();
		sbBussinessExampleText.append("Question: ").append(bussinessExampleEntity.getQuestion()).append("\n");
		sbBussinessExampleText.append("Business logic: ").append(bussinessExampleEntity.getContent()).append("\n");

		Response<Embedding> embeddingResponse = embeddingService.embedding(sbBussinessExampleText.toString(), domainId);
		float[] embededVector = embeddingResponse.content().vector();
		PGvector pgVector = new PGvector(embededVector);

		if (bussinessExampleEntity.getCreateTimestamp() == null) {
			bussinessExampleEntity.setCreateTimestamp(System.currentTimeMillis());
		}
		if (bussinessExampleEntity.getModifyTimestamp() == null) {
			bussinessExampleEntity.setModifyTimestamp(System.currentTimeMillis());
		}

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ", example_vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?::vector) "
						+ "ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, content = EXCLUDED.content, "
						+ "status = EXCLUDED.status, create_timestamp = EXCLUDED.create_timestamp, "
						+ "modify_timestamp = EXCLUDED.modify_timestamp, domain_id = EXCLUDED.domain_id, "
						+ "example_vector = EXCLUDED.example_vector",
				exampleID, bussinessExampleEntity.getQuestion(), bussinessExampleEntity.getContent(),
				bussinessExampleEntity.getStatus(), bussinessExampleEntity.getCreateTimestamp(),
				bussinessExampleEntity.getModifyTimestamp(), domainId, pgVector);
	}

	public void deleteKnowledge(String exampleID) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ?", exampleID);
	}

	public List<BusinessExampleQuestionSpliterEntity> findBussinessExample(String question, int maxResult, String domainId) {
		List<BusinessExampleQuestionSpliterEntity> bussinessExampleEntities = new ArrayList<>();
		float[] findVector = null;
		String queryString = "";
		try {
			Response<Embedding> embeddingResponse = embeddingService.embedding(question, domainId);
			findVector = embeddingResponse.content().vector();

			queryString = "SELECT " + COLUMNS + " FROM " + TABLE_NAME
					+ " WHERE status = 1 AND domain_id = ? ORDER BY example_vector <-> ?::vector LIMIT ?";
			PGvector pgVector = new PGvector(findVector);

			bussinessExampleEntities = jdbcTemplate.query(queryString,
					(rs, rowNum) -> mapRow(rs), domainId, pgVector, maxResult);
		} catch (Exception exp) {
			if (findVector == null) {
				log.error("Vector query error:{},question:{},findVector length={},queryString:\n{}", exp.getMessage(), question, 0, queryString);
			} else {
				log.error("Vector query error:{},question:{},findVector length={},queryString:\n{}", exp.getMessage(), question, findVector.length, queryString);
			}
		}
		return bussinessExampleEntities;
	}

	public List<BusinessExampleQuestionSpliterEntity> getAllBussinessExample(String domainId) {
		List<BusinessExampleQuestionSpliterEntity> bussinessExampleEntities = new ArrayList<>();
		try {
			bussinessExampleEntities = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE domain_id = ?",
					(rs, rowNum) -> mapRow(rs), domainId);
		} catch (Exception exp) {
			log.error("match_all query exception:{}", exp.getMessage());
		}
		return bussinessExampleEntities;
	}

	private BusinessExampleQuestionSpliterEntity mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
		BusinessExampleQuestionSpliterEntity entity = new BusinessExampleQuestionSpliterEntity();
		entity.setId(rs.getString("id"));
		entity.setQuestion(rs.getString("question"));
		entity.setContent(rs.getString("content"));
		entity.setStatus(rs.getInt("status"));
		entity.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		entity.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		return entity;
	}

}
