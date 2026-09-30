package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.task.WriteTask;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("writeTaskDao")
public class WriteTaskDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "write_task";

	private static final String COLUMNS = "id, name, description, function_id, status, cron, class_names, service_id, domain_id, create_timestamp, modify_timestamp";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "name VARCHAR(255), "
				+ "description TEXT, "
				+ "function_id VARCHAR(64), "
				+ "status VARCHAR(32), "
				+ "cron VARCHAR(64), "
				+ "class_names TEXT, "
				+ "service_id VARCHAR(64), "
				+ "domain_id VARCHAR(64), "
				+ "create_timestamp BIGINT, "
				+ "modify_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_function_id ON " + TABLE_NAME + "(function_id)");
		log.info(">>>writeTask table initialization complete");
	}

	public WriteTask save(WriteTask writeTask) {
		if (writeTask.getId() == null) {
			writeTask.setId(UUID.randomUUID().toString());
		}
		Long now = System.currentTimeMillis();
		if (writeTask.getCreateTimestamp() == null) {
			writeTask.setCreateTimestamp(now);
		}
		writeTask.setModifyTimestamp(now);
		Function function = writeTask.getFunction();

		String classNamesStr = buildClassNamesStr(function);

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, "
						+ "function_id = EXCLUDED.function_id, status = EXCLUDED.status, cron = EXCLUDED.cron, "
						+ "class_names = EXCLUDED.class_names, service_id = EXCLUDED.service_id, "
						+ "domain_id = EXCLUDED.domain_id, create_timestamp = EXCLUDED.create_timestamp, "
						+ "modify_timestamp = EXCLUDED.modify_timestamp",
				writeTask.getId(), writeTask.getName(), writeTask.getDescription(),
				function.getId(), writeTask.getStatus(), writeTask.getCron(), classNamesStr,
				writeTask.getServiceId(), writeTask.getDomainId(),
				writeTask.getCreateTimestamp(), writeTask.getModifyTimestamp());
		return writeTask;
	}

	private String buildClassNamesStr(Function function) {
		Set<String> classNames = new HashSet<String>();
		if (function != null) {
			List<Parameter> parameters = function.getParameters();
			if (parameters != null) {
				for (Parameter parameter : parameters) {
					if (parameter.getClassNames() != null && parameter.getClassNames().size() > 0) {
						classNames.addAll(parameter.getClassNames());
					}
				}
			}
			if (function.getReturnDef() != null && function.getReturnDef().getClassNames() != null) {
				classNames.addAll(function.getReturnDef().getClassNames());
			}
		}
		StringBuilder sb = new StringBuilder(",");
		for (String className : classNames) {
			sb.append(className).append(",");
		}
		return sb.toString();
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ?", id);
	}

	public Object[] queryById(String id) {
		WriteTask writeTask = null;
		String functionId = null;
		try {
			List<Object[]> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ?",
					(rs, rowNum) -> mapRowWithFunctionId(rs), id);
			if (!list.isEmpty()) {
				Object[] row = list.get(0);
				writeTask = (WriteTask) row[0];
				functionId = (String) row[1];
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		if (writeTask == null) {
			return null;
		} else {
			return new Object[] { writeTask, functionId };
		}
	}

	public List<Object[]> queryList(String status, String functionId, String className, String domainId) {
		List<Object[]> oList = new ArrayList<Object[]>();
		try {
			StringBuilder whereSql = new StringBuilder("1 = 1");
			List<Object> params = new ArrayList<>();
			if (status != null && !"".equals(status.trim())) {
				whereSql.append(" AND status = ?");
				params.add(status.trim());
			}
			if (functionId != null && !"".equals(functionId.trim())) {
				whereSql.append(" AND function_id = ?");
				params.add(functionId.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			oList = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql + " ORDER BY modify_timestamp DESC",
					(rs, rowNum) -> mapRowWithFunctionId(rs), params.toArray());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return oList;
	}

	private Object[] mapRowWithFunctionId(java.sql.ResultSet rs) throws java.sql.SQLException {
		WriteTask writeTask = new WriteTask();
		writeTask.setId(rs.getString("id"));
		writeTask.setName(rs.getString("name"));
		writeTask.setDescription(rs.getString("description"));
		writeTask.setStatus(rs.getString("status"));
		writeTask.setCron(rs.getString("cron"));
		writeTask.setServiceId(rs.getString("service_id"));
		writeTask.setDomainId(rs.getString("domain_id"));
		writeTask.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		writeTask.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		String functionId = rs.getString("function_id");
		return new Object[] { writeTask, functionId };
	}

}
