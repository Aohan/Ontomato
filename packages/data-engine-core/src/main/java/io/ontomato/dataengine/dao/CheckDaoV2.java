package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("checkDaoV2")
public class CheckDaoV2 {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "check_v2";

	private static final String COLUMNS = "session_id, origin_question, program_descriptions, score, conclusion, fitted_question, lang, create_timestamp, finished";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "session_id VARCHAR(128) PRIMARY KEY, "
				+ "origin_question TEXT, "
				+ "program_descriptions TEXT, "
				+ "score DOUBLE PRECISION, "
				+ "conclusion TEXT, "
				+ "fitted_question TEXT, "
				+ "lang VARCHAR(32), "
				+ "create_timestamp BIGINT, "
				+ "finished BOOLEAN"
				+ ")");
		log.info(">>>checkV2 table initialization complete");
	}

	public void save(ABCHarnessCheck task) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (session_id) DO UPDATE SET origin_question = EXCLUDED.origin_question, "
						+ "program_descriptions = EXCLUDED.program_descriptions, score = EXCLUDED.score, "
						+ "conclusion = EXCLUDED.conclusion, fitted_question = EXCLUDED.fitted_question, "
						+ "lang = EXCLUDED.lang, create_timestamp = EXCLUDED.create_timestamp, finished = EXCLUDED.finished",
				task.getSessionId(), task.getOriginQuestion(),
				task.getProgramDescriptions() == null ? null
						: JSON.toJSONString(task.getProgramDescriptions(), Feature.WriteMapNullValue),
				task.getScore(), task.getConclusion(), task.getFittedQuestion(),
				task.getLang(), task.getCreateTimestamp(), task.getFinished());
	}

	public void delete(String sessionId) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE session_id = ?", sessionId);
	}

	public ABCHarnessCheck queryBySessionId(String sessionId) {
		ABCHarnessCheck task = null;
		try {
			List<ABCHarnessCheck> tasks = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE session_id = ?",
					(rs, rowNum) -> mapRow(rs), sessionId);
			if (!tasks.isEmpty()) {
				task = tasks.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			task = null;
		}
		return task;
	}

	public List<ABCHarnessCheck> queryList() {
		List<ABCHarnessCheck> tasks = new ArrayList<ABCHarnessCheck>();
		try {
			tasks = jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME,
					(rs, rowNum) -> mapRow(rs));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return tasks;
	}

	private ABCHarnessCheck mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
		ABCHarnessCheck task = new ABCHarnessCheck();
		task.setSessionId(rs.getString("session_id"));
		task.setOriginQuestion(rs.getString("origin_question"));
		String programDescriptions = rs.getString("program_descriptions");
		task.setProgramDescriptions(programDescriptions == null ? null
				: JSONArray.parseArray(programDescriptions, ABCHarnessProgramDescription.class));
		task.setScore(rs.getObject("score") == null ? null : rs.getDouble("score"));
		task.setConclusion(rs.getString("conclusion"));
		task.setFittedQuestion(rs.getString("fitted_question"));
		task.setLang(rs.getString("lang"));
		task.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		task.setFinished(rs.getObject("finished") == null ? null : rs.getBoolean("finished"));
		return task;
	}

}
