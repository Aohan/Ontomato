package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.bean.task.WriteTaskResult;
import io.ontomato.dataengine.core.bean.Page;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("writeTaskResultDao")
public class WriteTaskResultDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "write_task_result";

	private static final String COLUMNS = "id, write_task_id, execute_timestamp, result, error, spend_time";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "write_task_id VARCHAR(64), "
				+ "execute_timestamp BIGINT, "
				+ "result TEXT, "
				+ "error TEXT, "
				+ "spend_time BIGINT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_write_task_id ON " + TABLE_NAME + "(write_task_id)");
		log.info(">>>writeTaskResult table initialization complete");
	}

	public void save(WriteTaskResult writeTaskResult) {
		if (writeTaskResult.getId() == null) {
			writeTaskResult.setId(UUID.randomUUID().toString());
		}
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET write_task_id = EXCLUDED.write_task_id, "
						+ "execute_timestamp = EXCLUDED.execute_timestamp, result = EXCLUDED.result, "
						+ "error = EXCLUDED.error, spend_time = EXCLUDED.spend_time",
				writeTaskResult.getId(), writeTaskResult.getWriteTaskId(), writeTaskResult.getExecuteTimestamp(),
				writeTaskResult.getResult(), writeTaskResult.getError(), writeTaskResult.getSpendTime());
	}

	public WriteTaskResult queryById(String id) {
		WriteTaskResult writeTaskResult = null;
		try {
			List<WriteTaskResult> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ?",
					(rs, rowNum) -> mapRow(rs), id);
			if (!list.isEmpty()) {
				writeTaskResult = list.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return writeTaskResult;
	}

	public Page<WriteTaskResult> queryPageByWriteTaskId(String writeTaskId, int pageNum, int pageSize) {
		Page<WriteTaskResult> page = new Page<WriteTaskResult>();
		page.setPageNum(pageNum);
		page.setPageSize(pageSize);

		try {
			String whereSql = "write_task_id = ?";
			Long totalRows = jdbcTemplate.queryForObject(
					"SELECT COUNT(*) FROM " + TABLE_NAME + " WHERE " + whereSql,
					Long.class, writeTaskId.trim());
			if (totalRows == null) {
				totalRows = 0L;
			}

			List<WriteTaskResult> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql
							+ " ORDER BY execute_timestamp DESC LIMIT ? OFFSET ?",
					(rs, rowNum) -> mapRow(rs),
					writeTaskId.trim(), pageSize, (pageNum - 1) * pageSize);

			page.setData(list);
			page.setTotalRows(totalRows);
			page.setTotalPages(totalRows % pageSize == 0 ? (totalRows / pageSize) : (totalRows / pageSize + 1));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return page;
	}

	private WriteTaskResult mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
		WriteTaskResult writeTaskResult = new WriteTaskResult();
		writeTaskResult.setId(rs.getString("id"));
		writeTaskResult.setWriteTaskId(rs.getString("write_task_id"));
		writeTaskResult.setExecuteTimestamp(rs.getObject("execute_timestamp") == null ? null : rs.getLong("execute_timestamp"));
		writeTaskResult.setResult(rs.getString("result"));
		writeTaskResult.setError(rs.getString("error"));
		writeTaskResult.setSpendTime(rs.getObject("spend_time") == null ? null : rs.getLong("spend_time"));
		return writeTaskResult;
	}

}
