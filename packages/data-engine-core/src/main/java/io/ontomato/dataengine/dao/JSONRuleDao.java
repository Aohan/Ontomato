package io.ontomato.dataengine.dao;

import java.util.List;
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
		removeRetiredPermissionFieldMarks();
		log.info(">>>jsonRule table initialization complete");
	}

	/**
	 * Parameterized row permissions no longer require fields to be marked in advance, so the retired
	 * {@code permissionField} attribute key is stripped from stored rules once at startup. Rows without the key
	 * are not touched, so later startups do nothing; each row is rewritten whole, so an interrupted run leaves
	 * only rows that the next startup finishes.
	 */
	void removeRetiredPermissionFieldMarks() {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"SELECT id, content FROM " + TABLE_NAME + " WHERE content LIKE ?", "%\"permissionField\"%");
		for (Map<String, Object> row : rows) {
			JSONObject jsonRule = JSONObject.parseObject((String) row.get("content"));
			if (!removePermissionFieldMarks(jsonRule)) continue;
			jdbcTemplate.update("UPDATE " + TABLE_NAME + " SET content = ? WHERE id = ?",
					JSON.toJSONString(jsonRule, Feature.WriteMapNullValue), row.get("id"));
			log.info("jsonRule retired permissionField marks removed (domainId={})", row.get("id"));
		}
	}

	static boolean removePermissionFieldMarks(JSONObject jsonRule) {
		boolean changed = false;
		List<?> classDefs = jsonRule.getJSONArray("classDef");
		if (classDefs == null) return false;
		for (Object classDef : classDefs) {
			if (!(classDef instanceof JSONObject definition)) continue;
			List<?> attrs = definition.getJSONArray("attrs");
			if (attrs == null) continue;
			for (Object attr : attrs) {
				if (attr instanceof JSONObject attrDef && attrDef.containsKey("permissionField")) {
					attrDef.remove("permissionField");
					changed = true;
				}
			}
		}
		return changed;
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
