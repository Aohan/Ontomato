package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.CheckAfterCalculateTask;
import io.ontomato.dataengine.bean.CheckSubQueryTask;
import io.ontomato.dataengine.bean.CheckTask;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("checkDao")
public class CheckDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String CHECK_TABLE = "check_task";
	private static final String DSL_TASK_TABLE = "check_dsl_task";
	private static final String AFTER_CALCULATE_TASK_TABLE = "check_after_calculate_task";

	private static final String CHECK_COLUMNS = "id, question, sub_query_task_size, after_calculate_task_size, status, score, conclusion, fitted_question, create_timestamp, service_id, lang, domain_id";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + CHECK_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "question TEXT, "
				+ "sub_query_task_size INTEGER, "
				+ "after_calculate_task_size INTEGER, "
				+ "status VARCHAR(64), "
				+ "score DOUBLE PRECISION, "
				+ "conclusion TEXT, "
				+ "fitted_question TEXT, "
				+ "create_timestamp BIGINT, "
				+ "service_id VARCHAR(64), "
				+ "lang VARCHAR(32), "
				+ "domain_id VARCHAR(64)"
				+ ")");

		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + DSL_TASK_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "parent_id VARCHAR(64), "
				+ "task_order INTEGER, "
				+ "dsl_str TEXT, "
				+ "summary TEXT, "
				+ "meaning TEXT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + DSL_TASK_TABLE + "_parent_id ON " + DSL_TASK_TABLE + "(parent_id)");

		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + AFTER_CALCULATE_TASK_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "parent_id VARCHAR(64), "
				+ "task_order INTEGER, "
				+ "logic TEXT, "
				+ "cache_file_paths TEXT, "
				+ "summary TEXT, "
				+ "meaning TEXT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + AFTER_CALCULATE_TASK_TABLE + "_parent_id ON " + AFTER_CALCULATE_TASK_TABLE + "(parent_id)");
		log.info(">>>check tables initialization complete");
	}

	public void writeTask(CheckTask task, String domainId) {
		deleteTask(task.getId(), false);

		jdbcTemplate.update(
				"INSERT INTO " + CHECK_TABLE + " (" + CHECK_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, "
						+ "sub_query_task_size = EXCLUDED.sub_query_task_size, after_calculate_task_size = EXCLUDED.after_calculate_task_size, "
						+ "status = EXCLUDED.status, score = EXCLUDED.score, conclusion = EXCLUDED.conclusion, "
						+ "fitted_question = EXCLUDED.fitted_question, create_timestamp = EXCLUDED.create_timestamp, "
						+ "service_id = EXCLUDED.service_id, lang = EXCLUDED.lang, domain_id = EXCLUDED.domain_id",
				task.getId(), task.getQuestion(),
				task.getSubQueryTasks() == null ? 0 : task.getSubQueryTasks().length,
				task.getAfterCalculateTasks() == null ? 0 : task.getAfterCalculateTasks().length,
				task.getStatus(), task.getScore(), task.getConclusion(), task.getFittedQuestion(),
				task.getCreateTimestamp(), task.getServiceId(), task.getLang(), domainId);
	}

	public void addSubQueryTask(String sessionId, int subQueryIndex, CheckSubQueryTask subQueryTask) {
		String id = UUID.randomUUID().toString();
		jdbcTemplate.update(
				"INSERT INTO " + DSL_TASK_TABLE + " (id, parent_id, task_order, dsl_str, summary, meaning) VALUES (?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, task_order = EXCLUDED.task_order, "
						+ "dsl_str = EXCLUDED.dsl_str, summary = EXCLUDED.summary, meaning = EXCLUDED.meaning",
				id, sessionId, subQueryIndex, subQueryTask.getDslStr(), subQueryTask.getSummary(), subQueryTask.getMeaning());
	}

	public void writeAfterCalculateTask(String sessionId, int afterCalculateIndex, CheckAfterCalculateTask afterCalculateTask) {
		CheckAfterCalculateTask existTask = null;
		CheckAfterCalculateTask[] afterCalculateTasks = getAfterCalculateTasks(sessionId, 1);
		if (afterCalculateTasks != null && afterCalculateIndex < afterCalculateTasks.length) {
			existTask = afterCalculateTasks[afterCalculateIndex];
		}
		String id = null;
		if (existTask == null) {
			id = UUID.randomUUID().toString();
		} else {
			deleteAfterCalculateTask(existTask.getId());
			id = existTask.getId();
		}

		jdbcTemplate.update(
				"INSERT INTO " + AFTER_CALCULATE_TASK_TABLE + " (id, parent_id, task_order, logic, cache_file_paths, summary, meaning) VALUES (?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, task_order = EXCLUDED.task_order, "
						+ "logic = EXCLUDED.logic, cache_file_paths = EXCLUDED.cache_file_paths, "
						+ "summary = EXCLUDED.summary, meaning = EXCLUDED.meaning",
				id, sessionId, afterCalculateIndex, afterCalculateTask.getLogic(),
				afterCalculateTask.getCacheFilePaths() == null ? null
						: JSON.toJSONString(afterCalculateTask.getCacheFilePaths(), Feature.WriteMapNullValue),
				afterCalculateTask.getSummary(), afterCalculateTask.getMeaning());
	}

	public void deleteTask(String id, boolean withAll) {
		jdbcTemplate.update("DELETE FROM " + CHECK_TABLE + " WHERE id = ?", id);

		if (withAll) {
			CheckSubQueryTask[] subQueryTasks = getSubQueryTasks(id, 100);
			if (subQueryTasks != null) {
				for (CheckSubQueryTask subQueryTask : subQueryTasks) {
					if (subQueryTask != null) {
						deleteSubQueryTask(subQueryTask.getId());
					}
				}
			}
			CheckAfterCalculateTask[] afterCalculateTasks = getAfterCalculateTasks(id, 100);
			if (afterCalculateTasks != null) {
				for (CheckAfterCalculateTask afterCalculateTask : afterCalculateTasks) {
					if (afterCalculateTask != null) {
						deleteAfterCalculateTask(afterCalculateTask.getId());
					}
				}
			}
		}
	}

	private void deleteSubQueryTask(String subQueryTaskId) {
		jdbcTemplate.update("DELETE FROM " + DSL_TASK_TABLE + " WHERE id = ?", subQueryTaskId);
	}

	private void deleteAfterCalculateTask(String afterCalculateTaskId) {
		jdbcTemplate.update("DELETE FROM " + AFTER_CALCULATE_TASK_TABLE + " WHERE id = ?", afterCalculateTaskId);
	}

	public CheckTask readTask(String id) {
		CheckTask task = null;
		try {
			List<CheckTask> list = jdbcTemplate.query(
					"SELECT " + CHECK_COLUMNS + " FROM " + CHECK_TABLE + " WHERE id = ?",
					(rs, rowNum) -> {
						CheckTask t = new CheckTask();
						t.setId(rs.getString("id"));
						t.setQuestion(rs.getString("question"));
						int subQueryTaskSize = rs.getObject("sub_query_task_size") == null ? 0 : rs.getInt("sub_query_task_size");
						int afterCalculateTaskSize = rs.getObject("after_calculate_task_size") == null ? 0 : rs.getInt("after_calculate_task_size");
						t.setSubQueryTasks(getSubQueryTasks(t.getId(), subQueryTaskSize));
						t.setAfterCalculateTasks(getAfterCalculateTasks(t.getId(), afterCalculateTaskSize));
						t.setStatus(rs.getString("status"));
						t.setScore(rs.getObject("score") == null ? null : rs.getDouble("score"));
						t.setConclusion(rs.getString("conclusion"));
						t.setFittedQuestion(rs.getString("fitted_question"));
						t.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
						t.setServiceId(rs.getString("service_id"));
						t.setLang(rs.getString("lang"));
						t.setDomainId(rs.getString("domain_id"));
						return t;
					}, id);
			if (!list.isEmpty()) {
				task = list.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			task = null;
		}
		return task;
	}

	private CheckSubQueryTask[] getSubQueryTasks(String id, Integer subQueryTaskSize) {
		if (subQueryTaskSize == null || subQueryTaskSize <= 0) {
			return new CheckSubQueryTask[0];
		}
		CheckSubQueryTask[] subTasks = new CheckSubQueryTask[subQueryTaskSize];
		try {
			jdbcTemplate.query(
					"SELECT id, task_order, dsl_str, summary, meaning FROM " + DSL_TASK_TABLE + " WHERE parent_id = ?",
					(rs, rowNum) -> {
						CheckSubQueryTask subTask = new CheckSubQueryTask();
						subTask.setId(rs.getString("id"));
						subTask.setDslStr(rs.getString("dsl_str"));
						subTask.setSummary(rs.getString("summary"));
						subTask.setMeaning(rs.getString("meaning"));
						int order = rs.getInt("task_order");
						if (order >= 0 && order < subTasks.length) {
							subTasks[order] = subTask;
						}
						return subTask;
					}, id);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return subTasks;
	}

	private CheckAfterCalculateTask[] getAfterCalculateTasks(String id, Integer afterCalculateTaskSize) {
		if (afterCalculateTaskSize == null || afterCalculateTaskSize <= 0) {
			return new CheckAfterCalculateTask[0];
		}
		CheckAfterCalculateTask[] subTasks = new CheckAfterCalculateTask[afterCalculateTaskSize];
		try {
			jdbcTemplate.query(
					"SELECT id, task_order, logic, cache_file_paths, summary, meaning FROM " + AFTER_CALCULATE_TASK_TABLE + " WHERE parent_id = ?",
					(rs, rowNum) -> {
						CheckAfterCalculateTask subTask = new CheckAfterCalculateTask();
						subTask.setId(rs.getString("id"));
						subTask.setLogic(rs.getString("logic"));
						String cacheFilePaths = rs.getString("cache_file_paths");
						subTask.setCacheFilePaths(cacheFilePaths == null ? null
								: JSONArray.parseArray(cacheFilePaths, String.class));
						subTask.setSummary(rs.getString("summary"));
						subTask.setMeaning(rs.getString("meaning"));
						int order = rs.getInt("task_order");
						if (order >= 0 && order < subTasks.length) {
							subTasks[order] = subTask;
						}
						return subTask;
					}, id);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return subTasks;
	}

	public List<CheckTask> readTasks() {
		List<CheckTask> tasks = new ArrayList<CheckTask>();
		try {
			List<String> ids = jdbcTemplate.queryForList(
					"SELECT id FROM " + CHECK_TABLE + " ORDER BY create_timestamp DESC", String.class);
			for (String id : ids) {
				CheckTask task = readTask(id);
				if (task != null) {
					tasks.add(task);
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return tasks;
	}

}
