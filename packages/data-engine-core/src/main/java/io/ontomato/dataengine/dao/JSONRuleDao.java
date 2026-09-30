package io.ontomato.dataengine.dao;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("jsonRuleDao")
public class JSONRuleDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "json_rule";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "content TEXT"
				+ ")");
		log.info(">>>jsonRule table initialization complete");
	}

	public void save(Map<String, Object> jsonRule, String domainId) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content",
				domainId, JSON.toJSONString(jsonRule, Feature.WriteMapNullValue));
	}

	public Map<String, Object> query(String domainId) {
		Map<String, Object> jsonRule = null;
		try {
			String content = jdbcTemplate.queryForObject(
					"SELECT content FROM " + TABLE_NAME + " WHERE id = ?",
					String.class, domainId);
			if (content != null) {
				jsonRule = JSONObject.parseObject(content);
			}
		} catch (org.springframework.dao.EmptyResultDataAccessException e) {
			return null;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return jsonRule;
	}
}
