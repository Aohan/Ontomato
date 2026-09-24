package io.ontomato.dataengine.dao;

import com.pgvector.PGvector;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.util.*;

@Slf4j
@Component("bussinessExampleDao")
public class BussinessExampleDao extends BaseDao {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EmbeddingService embeddingService;

    private static final String TABLE_NAME = "bussinessexampleindex";

    private static final String COLUMNS = "example_id, example_question, example_a, example_b, example_c, example_important, status, modify_time, domain_id";

    @PostConstruct
    public void initIndex() {
        try {
            jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector");
        } catch (Exception e) {
            log.warn(">>>Cannot create pgvector extension: {}", e.getMessage());
        }
        jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
                        + "example_id VARCHAR(64) PRIMARY KEY, "
                        + "example_question TEXT, "
                        + "example_a TEXT, "
                        + "example_b TEXT, "
                        + "example_c TEXT, "
                        + "example_important TEXT, "
                        + "status INTEGER DEFAULT 0, "
                        + "modify_time TIMESTAMP, "
                        + "domain_id VARCHAR(64), "
                        + "example_vector vector(" + embeddingModelProperties.getDimensions() + ")"
                        + ")");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
    }

    public List<BussinessExampleEntity> findBussinessExample(String question, int maxResult, String domainId) {
        List<BussinessExampleEntity> bussinessExampleEntities = new ArrayList<>();
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

    public List<BussinessExampleEntity> getAllBussinessExample(String domainId) {
        List<BussinessExampleEntity> bussinessExampleEntities = new ArrayList<>();
        try {
            bussinessExampleEntities = jdbcTemplate.query(
                    "SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE domain_id = ?",
                    (rs, rowNum) -> mapRow(rs), domainId);
        } catch (Exception exp) {
            log.error("match_all query exception:{}", exp.getMessage());
        }
        return bussinessExampleEntities;
    }

    public void insertBussinessExample(BussinessExampleEntity bussinessExampleEntity, String domainId) {
        String exampleID = bussinessExampleEntity.getExampleID();
        StringBuilder sbBussinessExampleText = new StringBuilder();
        sbBussinessExampleText.append("Question:").append(bussinessExampleEntity.getExampleQuestion()).append("\n");
        sbBussinessExampleText.append("StepA:").append(bussinessExampleEntity.getExampleA()).append("\n");
        sbBussinessExampleText.append("StepB:").append(bussinessExampleEntity.getExampleB()).append("\n");
        sbBussinessExampleText.append("StepC:").append(bussinessExampleEntity.getExampleC()).append("\n");
        sbBussinessExampleText.append("Key points:").append(bussinessExampleEntity.getExampleImportant()).append("\n");

        Response<Embedding> embeddingResponse = embeddingService.embedding(sbBussinessExampleText.toString(), domainId);
        float[] embededVector = embeddingResponse.content().vector();
        PGvector pgVector = new PGvector(embededVector);

        Timestamp modifyTimestamp = bussinessExampleEntity.getModifyTime() != null
                ? new Timestamp(bussinessExampleEntity.getModifyTime().getTime())
                : new Timestamp(System.currentTimeMillis());

        jdbcTemplate.update(
                "INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ", example_vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::vector) "
                        + "ON CONFLICT (example_id) DO UPDATE SET example_question = EXCLUDED.example_question, "
                        + "example_a = EXCLUDED.example_a, example_b = EXCLUDED.example_b, "
                        + "example_c = EXCLUDED.example_c, example_important = EXCLUDED.example_important, "
                        + "status = EXCLUDED.status, modify_time = EXCLUDED.modify_time, "
                        + "domain_id = EXCLUDED.domain_id, example_vector = EXCLUDED.example_vector",
                exampleID, bussinessExampleEntity.getExampleQuestion(), bussinessExampleEntity.getExampleA(),
                bussinessExampleEntity.getExampleB(), bussinessExampleEntity.getExampleC(),
                bussinessExampleEntity.getExampleImportant(), bussinessExampleEntity.getStatus(),
                modifyTimestamp, domainId, pgVector);
    }

    public void deleteKnowledge(String exampleID) {
        jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE example_id = ?", exampleID);
    }

    private BussinessExampleEntity mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        BussinessExampleEntity entity = new BussinessExampleEntity();
        entity.setExampleID(rs.getString("example_id"));
        entity.setExampleQuestion(rs.getString("example_question"));
        entity.setExampleA(rs.getString("example_a"));
        entity.setExampleB(rs.getString("example_b"));
        entity.setExampleC(rs.getString("example_c"));
        entity.setExampleImportant(rs.getString("example_important"));
        entity.setStatus(rs.getInt("status"));
        Timestamp ts = rs.getTimestamp("modify_time");
        if (ts != null) {
            entity.setModifyTime(new Date(ts.getTime()));
        }
        return entity;
    }

}
