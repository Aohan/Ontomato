package io.ontomato.dataengine.dao;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("businessConfigDao")
public class BusinessConfigDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "business_config";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "content TEXT"
				+ ")");
		log.info(">>>businessConfig table initialization complete");
	}

	public void save(BusinessConfig businessConfig, String domainId) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content",
				domainId, JSON.toJSONString(businessConfig, Feature.WriteMapNullValue));
	}

	public BusinessConfig query(String domainId) {
		try {
			String content = jdbcTemplate.queryForObject(
					"SELECT content FROM " + TABLE_NAME + " WHERE id = ?",
					String.class, domainId);
			if (content == null) {
				return null;
			}
			JSONObject stored = JSON.parseObject(content, JSONReader.Feature.DisableReferenceDetect);
			if (stored == null) {
				return null;
			}
			if (!stored.containsKey("models")) {
				throw new IllegalStateException(
						"business_config record is in the old format; run the upgrade migration first (domainId=" + domainId + ")");
			}
			try {
				ModelResolver.rejectLegacyRoleFields(stored.getJSONObject("agents"));
			} catch (IllegalArgumentException e) {
				throw new IllegalStateException(
						"business_config record still contains role-side model parameters; run the upgrade migration first (domainId="
								+ domainId + "): " + e.getMessage());
			}
			return JSON.parseObject(
					content, BusinessConfig.class, JSONReader.Feature.DisableReferenceDetect);
		} catch (org.springframework.dao.EmptyResultDataAccessException e) {
			return null;
		} catch (RuntimeException e) {
			log.error("Failed to read BusinessConfig from PostgreSQL", e);
			throw e;
		}
	}
}
