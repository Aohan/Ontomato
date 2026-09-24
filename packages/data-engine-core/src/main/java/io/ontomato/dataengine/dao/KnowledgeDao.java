package io.ontomato.dataengine.dao;

import com.alibaba.fastjson2.JSON;
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
@Component("knowledgeDao")
public class KnowledgeDao extends BaseDao {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EmbeddingService embeddingService;

    private static final String TABLE_NAME = "knowledgeindex";

    private static final String COLUMNS = "knowledge_id, knowledge_title, knowledge_text, knowledge_tags, creator_type, status, modify_time, domain_id";

    @PostConstruct
    public void initIndex() {
        try {
            jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector");
        } catch (Exception e) {
            log.warn(">>>Cannot create pgvector extension: {}", e.getMessage());
        }
        jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
                        + "knowledge_id VARCHAR(64) PRIMARY KEY, "
                        + "knowledge_title VARCHAR(500), "
                        + "knowledge_text TEXT, "
                        + "knowledge_tags TEXT, "
                        + "creator_type INTEGER DEFAULT 0, "
                        + "status INTEGER DEFAULT 0, "
                        + "modify_time TIMESTAMP, "
                        + "domain_id VARCHAR(64), "
                        + "knowledge_vector vector(" + embeddingModelProperties.getDimensions() + ")"
                        + ")");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_status ON " + TABLE_NAME + "(status)");
    }

    public List<KnowledgeEntity> findKnowledge(String question, int maxResult, String domainId) {
        List<KnowledgeEntity> knowledgeEntities = new ArrayList<>();
        float[] findVector = null;
        String queryString = "";
        try {
            Response<Embedding> embeddingResponse = embeddingService.embedding(question, domainId);
            findVector = embeddingResponse.content().vector();

            queryString = "SELECT " + COLUMNS + " FROM " + TABLE_NAME
                    + " WHERE status = 1 AND domain_id = ? ORDER BY knowledge_vector <-> ?::vector LIMIT ?";
            PGvector pgVector = new PGvector(findVector);

            knowledgeEntities = jdbcTemplate.query(queryString,
                    (rs, rowNum) -> mapRow(rs), domainId, pgVector, maxResult);

            for (KnowledgeEntity e : knowledgeEntities) {
                log.info(">>>Get business knowledge from the vector store:{} ", e.getKnowledgeTitle());
            }
        } catch (Exception exp) {
            if (findVector == null) {
                log.error("Vector query error:{},question:{},findVector length={},queryString:\n{}", exp.getMessage(), question, 0, queryString);
            } else {
                log.error("Vector query error:{},question:{},findVector length={},queryString:\n{}", exp.getMessage(), question, findVector.length, queryString);
            }
        }
        return knowledgeEntities;
    }

    public List<KnowledgeEntity> getAllKnowledge(String domainId) {
        List<KnowledgeEntity> knowledgeEntities = new ArrayList<>();
        try {
            knowledgeEntities = jdbcTemplate.query(
                    "SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE domain_id = ?",
                    (rs, rowNum) -> mapRow(rs), domainId);
        } catch (Exception exp) {
            log.error("matchAllQuery error:{}", exp.getMessage());
        }
        return knowledgeEntities;
    }

    public void insertKnowledge(String knowledgeid, String domainId,
                                String knowledgeTitle, String knowledgeText,
                                List<String> knowledgeTags, int creatorType, int status,
                                Date modifyTime) {
        Response<Embedding> embeddingResponse = embeddingService.embedding(knowledgeText, domainId);
        float[] embededVector = embeddingResponse.content().vector();
        PGvector pgVector = new PGvector(embededVector);

        String tagsJson = (knowledgeTags != null && !knowledgeTags.isEmpty())
                ? JSON.toJSONString(knowledgeTags) : "[]";

        Timestamp modifyTimestamp = modifyTime != null
                ? new Timestamp(modifyTime.getTime())
                : new Timestamp(System.currentTimeMillis());

        jdbcTemplate.update(
                "INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ", knowledge_vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::vector) "
                        + "ON CONFLICT (knowledge_id) DO UPDATE SET knowledge_title = EXCLUDED.knowledge_title, "
                        + "knowledge_text = EXCLUDED.knowledge_text, knowledge_tags = EXCLUDED.knowledge_tags, "
                        + "creator_type = EXCLUDED.creator_type, status = EXCLUDED.status, "
                        + "modify_time = EXCLUDED.modify_time, domain_id = EXCLUDED.domain_id, "
                        + "knowledge_vector = EXCLUDED.knowledge_vector",
                knowledgeid, knowledgeTitle, knowledgeText, tagsJson, creatorType, status,
                modifyTimestamp, domainId, pgVector);
    }

    public void deleteKnowledge(String knowledgeid) {
        jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE knowledge_id = ?", knowledgeid);
    }

    private KnowledgeEntity mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        KnowledgeEntity entity = new KnowledgeEntity();
        entity.setKnowledgeID(rs.getString("knowledge_id"));
        entity.setKnowledgeTitle(rs.getString("knowledge_title"));
        entity.setKnowledgeText(rs.getString("knowledge_text"));

        String tagsStr = rs.getString("knowledge_tags");
        if (tagsStr != null && !tagsStr.isEmpty()) {
            entity.setKnowledgeTags(JSON.parseArray(tagsStr, String.class));
        } else {
            entity.setKnowledgeTags(new ArrayList<>());
        }

        entity.setCreatorType(rs.getInt("creator_type"));
        entity.setStatus(rs.getInt("status"));

        Timestamp ts = rs.getTimestamp("modify_time");
        if (ts != null) {
            entity.setModifyTime(new Date(ts.getTime()));
        }
        return entity;
    }

}
