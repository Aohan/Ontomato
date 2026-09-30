package io.ontomato.dataengine.dao;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("queryExampleConfigDao")
public class QueryExampleConfigDao {

	public static final String QUESTION_SPLITER = "questionSpliter";
	public static final String DSL_COOKER = "dslCooker";
	public static final String ABC_PROGRAMMER = "abcProgrammer";

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "query_example_config";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "content TEXT"
				+ ")");
		log.info(">>>queryExampleConfig table initialization complete");
	}

	public synchronized void save(String domainId, String field, String content, boolean inheritDefault) {
		JSONObject config = query(domainId);
		if (inheritDefault) {
			config.remove(field);
		} else {
			config.put(field, content);
		}

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content",
				domainId, config.toJSONString());
	}

	public JSONObject query(String domainId) {
		try {
			String content = jdbcTemplate.queryForObject(
					"SELECT content FROM " + TABLE_NAME + " WHERE id = ?",
					String.class, domainId);
			if (content == null) {
				return new JSONObject();
			}
			JSONObject jsonObject = JSON.parseObject(content);
			return jsonObject != null ? jsonObject : new JSONObject();
		} catch (EmptyResultDataAccessException e) {
			return new JSONObject();
		} catch (RuntimeException e) {
			log.error("Failed to read QueryExampleConfig from PostgreSQL", e);
			throw e;
		}
	}
}
