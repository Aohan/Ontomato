package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.abcQuestion.ABCSubQueryTask;
import io.ontomato.dataengine.bean.abcQuestion.ABCSubQueryTaskData;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.ShortCodeGenerator;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("abcSubQueryTaskDao")
public class ABCSubQueryTaskDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TASK_TABLE = "abc_sub_query_task";
	private static final String DATA_TABLE = "abc_sub_query_task_data";

	private static final String TASK_COLUMNS = "id, session_id, question, sub_query, type, task_index, return_node_ids, return_sse, permission, data_map, cache_schema_def, row_permission_data_map, dsl_consanguinity_map_list, after_calculator_consanguinity_list";

	private static final String DATAMAP = "DATAMAP";
	private static final String ROWPERMISSIONDATAMAP = "ROWPERMISSIONDATAMAP";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TASK_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "session_id VARCHAR(128), "
				+ "question TEXT, "
				+ "sub_query TEXT, "
				+ "type VARCHAR(32), "
				+ "task_index INTEGER, "
				+ "return_node_ids BOOLEAN, "
				+ "return_sse BOOLEAN, "
				+ "permission TEXT, "
				+ "data_map TEXT, "
				+ "cache_schema_def TEXT, "
				+ "row_permission_data_map TEXT, "
				+ "dsl_consanguinity_map_list TEXT, "
				+ "after_calculator_consanguinity_list TEXT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TASK_TABLE + "_session_id ON " + TASK_TABLE + "(session_id)");

		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + DATA_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "sub_query_id VARCHAR(64), "
				+ "type VARCHAR(32), "
				+ "task_index INTEGER, "
				+ "data TEXT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + DATA_TABLE + "_sub_query_id ON " + DATA_TABLE + "(sub_query_id, type)");
		log.info(">>>abcSubQueryTask tables initialization complete");
	}

	public void save(ABCSubQueryTask task, boolean isRaw) {
		if (task.getDataMap() == null) {
			// keep null
		} else if (isRaw) {
			saveData(task.getId(), DATAMAP, task.getDataMap());
		}

		if (task.getRowPermissionDataMap() != null && isRaw) {
			saveData(task.getId(), ROWPERMISSIONDATAMAP, task.getRowPermissionDataMap());
		}

		jdbcTemplate.update(
				"INSERT INTO " + TASK_TABLE + " (" + TASK_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, question = EXCLUDED.question, "
						+ "sub_query = EXCLUDED.sub_query, type = EXCLUDED.type, task_index = EXCLUDED.task_index, "
						+ "return_node_ids = EXCLUDED.return_node_ids, return_sse = EXCLUDED.return_sse, "
						+ "permission = EXCLUDED.permission, data_map = EXCLUDED.data_map, "
						+ "cache_schema_def = EXCLUDED.cache_schema_def, row_permission_data_map = EXCLUDED.row_permission_data_map, "
						+ "dsl_consanguinity_map_list = EXCLUDED.dsl_consanguinity_map_list, "
						+ "after_calculator_consanguinity_list = EXCLUDED.after_calculator_consanguinity_list",
				task.getId(), task.getSessionId(), task.getQuestion(),
				task.getSubQuery() == null ? null : JSON.toJSONString(task.getSubQuery(), Feature.WriteMapNullValue),
				task.getType(), task.getIndex(), task.getReturnNodeIds(), task.getReturnSSE(),
				task.getPermission() == null ? null : JSON.toJSONString(task.getPermission(), Feature.WriteMapNullValue),
				task.getDataMap() == null ? null : JSON.toJSONString(task.getDataMap(), Feature.WriteMapNullValue),
				task.getCacheSchemaDef() == null ? null : JSON.toJSONString(task.getCacheSchemaDef(), Feature.WriteMapNullValue),
				task.getRowPermissionDataMap() == null ? null : JSON.toJSONString(task.getRowPermissionDataMap(), Feature.WriteMapNullValue),
				task.getDslConsanguinityMapList() == null ? null : JSON.toJSONString(task.getDslConsanguinityMapList(), Feature.WriteMapNullValue),
				task.getAfterCalculatorConsanguinityList() == null ? null : JSON.toJSONString(task.getAfterCalculatorConsanguinityList(), Feature.WriteMapNullValue));
	}

	public void delete(String id) {
		ABCSubQueryTask exist = queryById(id, false, false);
		if (exist != null) {
			jdbcTemplate.update("DELETE FROM " + TASK_TABLE + " WHERE id = ?", id);

			if (exist.getDataMap() != null && exist.getDataMap().getJSONArray("data") != null && exist.getDataMap().getJSONArray("data").size() > 0
					&& exist.getDataMap().getJSONArray("data").getJSONObject(0) != null && exist.getDataMap().getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
				JSONArray dataIds = exist.getDataMap().getJSONArray("data").getJSONObject(0).getJSONArray("answer");
				for (int i = 0; i < dataIds.size(); i++) {
					String dataId = dataIds.getString(i);
					deleteData(dataId);
				}
			}
			if (exist.getRowPermissionDataMap() != null && exist.getRowPermissionDataMap().getJSONArray("data") != null && exist.getRowPermissionDataMap().getJSONArray("data").size() > 0
					&& exist.getRowPermissionDataMap().getJSONArray("data").getJSONObject(0) != null && exist.getRowPermissionDataMap().getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
				JSONArray dataIds = exist.getRowPermissionDataMap().getJSONArray("data").getJSONObject(0).getJSONArray("answer");
				for (int i = 0; i < dataIds.size(); i++) {
					String dataId = dataIds.getString(i);
					deleteData(dataId);
				}
			}
		}
	}

	public void deleteBySessionId(String sessionId) {
		List<ABCSubQueryTask> subQueryTasks = queryBySessionId(sessionId, false, false);
		for (ABCSubQueryTask subQueryTask : subQueryTasks) {
			delete(subQueryTask.getId());
		}
	}

	public ABCSubQueryTask queryById(String id, boolean withDataMap, boolean withRowPermissionDataMap) {
		ABCSubQueryTask task = null;
		try {
			List<ABCSubQueryTask> list = jdbcTemplate.query(
					"SELECT " + TASK_COLUMNS + " FROM " + TASK_TABLE + " WHERE id = ?",
					(rs, rowNum) -> mapRow(rs, withDataMap, withRowPermissionDataMap), id);
			if (!list.isEmpty()) {
				task = list.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return task;
	}

	public List<ABCSubQueryTask> queryBySessionId(String sessionId, boolean withDataMap, boolean withRowPermissionDataMap) {
		List<ABCSubQueryTask> subQueryTasks = new ArrayList<ABCSubQueryTask>();
		try {
			subQueryTasks = jdbcTemplate.query(
					"SELECT " + TASK_COLUMNS + " FROM " + TASK_TABLE + " WHERE session_id = ? ORDER BY task_index",
					(rs, rowNum) -> mapRow(rs, withDataMap, withRowPermissionDataMap), sessionId);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return subQueryTasks;
	}

	private ABCSubQueryTask mapRow(java.sql.ResultSet rs, boolean withDataMap, boolean withRowPermissionDataMap) throws java.sql.SQLException {
		ABCSubQueryTask task = new ABCSubQueryTask();
		task.setId(rs.getString("id"));
		task.setSessionId(rs.getString("session_id"));
		task.setQuestion(rs.getString("question"));
		String subQuery = rs.getString("sub_query");
		task.setSubQuery(subQuery == null ? null : JSONObject.parseObject(subQuery));
		task.setType(rs.getString("type"));
		task.setIndex(rs.getObject("task_index") == null ? null : rs.getInt("task_index"));
		task.setReturnNodeIds(rs.getObject("return_node_ids") == null ? null : rs.getBoolean("return_node_ids"));
		task.setReturnSSE(rs.getObject("return_sse") == null ? null : rs.getBoolean("return_sse"));
		String permission = rs.getString("permission");
		task.setPermission(permission == null ? null : JSONObject.parseObject(permission, UserDataPermission.class));

		String dataMapStr = rs.getString("data_map");
		if (dataMapStr != null) {
			JSONObject dataMap = JSONObject.parseObject(dataMapStr);
			if (withDataMap) {
				JSONArray rawAnswer = queryDataByTaskId(task.getId(), DATAMAP);
				if (dataMap.getJSONArray("data") != null && dataMap.getJSONArray("data").size() > 0
						&& dataMap.getJSONArray("data").getJSONObject(0) != null && dataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
					dataMap.getJSONArray("data").getJSONObject(0).put("answer", rawAnswer);
				}
			}
			task.setDataMap(dataMap);
		}

		String cacheSchemaDef = rs.getString("cache_schema_def");
		task.setCacheSchemaDef(cacheSchemaDef == null ? null : JSONObject.parseObject(cacheSchemaDef));

		String rowPermissionDataMapStr = rs.getString("row_permission_data_map");
		if (rowPermissionDataMapStr != null) {
			JSONObject dataMap = JSONObject.parseObject(rowPermissionDataMapStr);
			if (withRowPermissionDataMap) {
				JSONArray rawAnswer = queryDataByTaskId(task.getId(), ROWPERMISSIONDATAMAP);
				if (dataMap.getJSONArray("data") != null && dataMap.getJSONArray("data").size() > 0
						&& dataMap.getJSONArray("data").getJSONObject(0) != null && dataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
					dataMap.getJSONArray("data").getJSONObject(0).put("answer", rawAnswer);
				}
			}
			task.setRowPermissionDataMap(dataMap);
		}

		String dslConsanguinityMapListStr = rs.getString("dsl_consanguinity_map_list");
		if (dslConsanguinityMapListStr != null) {
			List<Map<String, DslConsanguinity>> dslConsanguinityMapList = new ArrayList<Map<String, DslConsanguinity>>();
			JSONArray array = JSONArray.parseArray(dslConsanguinityMapListStr);
			for (int i = 0; i < array.size(); i++) {
				JSONObject obj = array.getJSONObject(i);
				Map<String, DslConsanguinity> dslConsanguinityMap = obj.toJavaObject(Map.class);
				dslConsanguinityMapList.add(dslConsanguinityMap);
			}
			task.setDslConsanguinityMapList(dslConsanguinityMapList);
		}

		String afterCalculatorConsanguinityListStr = rs.getString("after_calculator_consanguinity_list");
		task.setAfterCalculatorConsanguinityList(afterCalculatorConsanguinityListStr == null ? null
				: JSONArray.parseArray(afterCalculatorConsanguinityListStr, AfterCalculatorConsanguinity.class));

		return task;
	}

	private void saveData(String id, String dataMapType, JSONObject data) {
		int batch = 1000;
		if (data.getJSONArray("data") != null && data.getJSONArray("data").size() > 0
				&& data.getJSONArray("data").getJSONObject(0) != null && data.getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
			String shortCode = ShortCodeGenerator.gerenate();
			JSONArray newData = new JSONArray();
			JSONArray answer = data.getJSONArray("data").getJSONObject(0).getJSONArray("answer");
			int index = 0;
			JSONArray newAnswer = new JSONArray();
			for (int i = 0; i < answer.size(); i++) {
				newAnswer.add(answer.get(i));
				if ((i + 1) % batch == 0) {
					String dataId = shortCode + "-" + index;
					insertData(dataId, id, dataMapType, index, newAnswer);
					newData.add(dataId);
					index++;
					newAnswer = new JSONArray();
				}
			}
			if (newAnswer.size() > 0) {
				String dataId = shortCode + "-" + index;
				insertData(dataId, id, dataMapType, index, newAnswer);
				newData.add(dataId);
			}
			data.getJSONArray("data").getJSONObject(0).put("answer", newData);
		}
	}

	private void insertData(String dataId, String subQueryId, String dataMapType, int index, JSONArray answer) {
		ABCSubQueryTaskData d = new ABCSubQueryTaskData();
		d.setId(dataId);
		d.setSubQueryId(subQueryId);
		d.setType(dataMapType);
		d.setIndex(index);
		d.setData(JSON.toJSONString(answer, Feature.WriteMapNullValue));
		jdbcTemplate.update(
				"INSERT INTO " + DATA_TABLE + " (id, sub_query_id, type, task_index, data) VALUES (?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET sub_query_id = EXCLUDED.sub_query_id, type = EXCLUDED.type, "
						+ "task_index = EXCLUDED.task_index, data = EXCLUDED.data",
				d.getId(), d.getSubQueryId(), d.getType(), d.getIndex(), d.getData());
	}

	private void deleteData(String dataId) {
		jdbcTemplate.update("DELETE FROM " + DATA_TABLE + " WHERE id = ?", dataId);
	}

	private JSONArray queryDataByTaskId(String taskId, String dataType) {
		JSONArray answer = new JSONArray();
		try {
			List<String> dataList = jdbcTemplate.queryForList(
					"SELECT data FROM " + DATA_TABLE + " WHERE sub_query_id = ? AND type = ? ORDER BY task_index",
					String.class, taskId, dataType);
			for (String data : dataList) {
				if (data != null) {
					JSONArray arr = JSONArray.parseArray(data);
					answer.addAll(arr);
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return answer;
	}

}
