package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.bean.abcQuestion.ABCTask;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("abcTaskDao")
public class ABCTaskDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "abc_task";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "session_id VARCHAR(128) PRIMARY KEY, "
				+ "ask_finished BOOLEAN, "
				+ "create_timestamp BIGINT"
				+ ")");
		log.info(">>>abcTask table initialization complete");
	}

	public void save(ABCTask task) {
		delete(task.getSessionId());
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (session_id, ask_finished, create_timestamp) VALUES (?, ?, ?)",
				task.getSessionId(), task.isAskFinished(), task.getCreateTimestamp());
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE session_id = ?", id);
	}

	public ABCTask queryById(String id) {
		ABCTask task = null;
		try {
			List<ABCTask> tasks = jdbcTemplate.query(
					"SELECT session_id, ask_finished, create_timestamp FROM " + TABLE_NAME + " WHERE session_id = ?",
					(rs, rowNum) -> {
						ABCTask t = new ABCTask();
						t.setSessionId(rs.getString("session_id"));
						t.setAskFinished(rs.getBoolean("ask_finished"));
						t.setCreateTimestamp(rs.getLong("create_timestamp"));
						return t;
					},
					id);
			if (!tasks.isEmpty()) {
				task = tasks.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return task;
	}

	public List<ABCTask> queryList() {
		List<ABCTask> tasks = new ArrayList<ABCTask>();
		try {
			tasks = jdbcTemplate.query(
					"SELECT session_id, ask_finished, create_timestamp FROM " + TABLE_NAME,
					(rs, rowNum) -> {
						ABCTask t = new ABCTask();
						t.setSessionId(rs.getString("session_id"));
						t.setAskFinished(rs.getBoolean("ask_finished"));
						t.setCreateTimestamp(rs.getLong("create_timestamp"));
						return t;
					});
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return tasks;
	}

}
