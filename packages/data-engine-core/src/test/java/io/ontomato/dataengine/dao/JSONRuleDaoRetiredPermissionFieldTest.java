package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

class JSONRuleDaoRetiredPermissionFieldTest {

	@Test
	void startupStripsTheRetiredMarkAndKeepsEverythingElse() {
		String stored = """
				{"datasetdesc":"d","classDef":[{"className":"/ns/order","attrs":[
				{"name":"id","type":"varchar","primaryKey":true,"permissionField":false},
				{"name":"region","type":"varchar","enable":true,"permissionField":true}]}]}""";
		JdbcTemplate jdbc = jdbc(List.of(Map.of("id", "d1", "content", stored)));

		dao(jdbc).initIndex();

		ArgumentCaptor<String> content = ArgumentCaptor.forClass(String.class);
		verify(jdbc).update(eq("UPDATE json_rule SET content = ? WHERE id = ?"), content.capture(), eq("d1"));
		JSONObject expected = JSON.parseObject(stored);
		expected.getJSONArray("classDef").getJSONObject(0).getJSONArray("attrs")
				.forEach(attr -> ((JSONObject) attr).remove("permissionField"));
		assertEquals(expected, JSON.parseObject(content.getValue()));
	}

	@Test
	void aRuleWhoseTextMatchesOnlyThroughAFieldNameIsNotRewritten() {
		String stored = """
				{"classDef":[{"className":"/ns/x","attrs":[{"name":"permissionField","type":"varchar"}]}]}""";
		JdbcTemplate jdbc = jdbc(List.of(Map.of("id", "d1", "content", stored)));

		dao(jdbc).initIndex();

		verify(jdbc, never()).update(eq("UPDATE json_rule SET content = ? WHERE id = ?"), any(), any());
		assertFalse(JSONRuleDao.removePermissionFieldMarks(JSON.parseObject(stored)));
	}

	private static JdbcTemplate jdbc(List<Map<String, Object>> markedRows) {
		JdbcTemplate jdbc = mock(JdbcTemplate.class);
		when(jdbc.queryForList(anyString(), eq("%\"permissionField\"%"))).thenReturn(markedRows);
		return jdbc;
	}

	private static JSONRuleDao dao(JdbcTemplate jdbc) {
		JSONRuleDao dao = new JSONRuleDao();
		ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
		return dao;
	}
}
