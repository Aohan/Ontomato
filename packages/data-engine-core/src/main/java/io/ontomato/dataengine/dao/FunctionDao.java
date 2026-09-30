package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("functionDao")
public class FunctionDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "function";

	private static final String COLUMNS = "id, name, origin, description, operation, parameters, return_def, code, logic, class_names, create_timestamp, modify_timestamp, domain_id";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "name VARCHAR(255), "
				+ "origin VARCHAR(32), "
				+ "description TEXT, "
				+ "operation VARCHAR(64), "
				+ "parameters TEXT, "
				+ "return_def TEXT, "
				+ "code TEXT, "
				+ "logic TEXT, "
				+ "class_names TEXT, "
				+ "create_timestamp BIGINT, "
				+ "modify_timestamp BIGINT, "
				+ "domain_id VARCHAR(64)"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
		log.info(">>>function table initialization complete");
	}

	public Function save(Function function) {
		if (function.getId() == null) {
			function.setId(UUID.randomUUID().toString());
		}
		Long now = System.currentTimeMillis();
		if (function.getCreateTimestamp() == null) {
			function.setCreateTimestamp(now);
		}
		function.setModifyTimestamp(now);

		String classNamesStr = buildClassNamesStr(function);

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, origin = EXCLUDED.origin, "
						+ "description = EXCLUDED.description, operation = EXCLUDED.operation, "
						+ "parameters = EXCLUDED.parameters, return_def = EXCLUDED.return_def, "
						+ "code = EXCLUDED.code, logic = EXCLUDED.logic, class_names = EXCLUDED.class_names, "
						+ "create_timestamp = EXCLUDED.create_timestamp, modify_timestamp = EXCLUDED.modify_timestamp, "
						+ "domain_id = EXCLUDED.domain_id",
				function.getId(), function.getName(), function.getOrigin(), function.getDescription(),
				function.getOperation(),
				JSON.toJSONString(function.getParameters(), Feature.WriteMapNullValue),
				JSON.toJSONString(function.getReturnDef(), Feature.WriteMapNullValue),
				function.getCode(), function.getLogic(), classNamesStr,
				function.getCreateTimestamp(), function.getModifyTimestamp(), function.getDomainId());
		return function;
	}

	private String buildClassNamesStr(Function function) {
		Set<String> classNames = new HashSet<String>();
		List<Parameter> parameters = function.getParameters();
		if (parameters != null) {
			for (Parameter parameter : parameters) {
				if (parameter.getClassNames() != null && parameter.getClassNames().size() > 0) {
					classNames.addAll(parameter.getClassNames());
				}
			}
		}
		ReturnDef returnDef = function.getReturnDef();
		if (returnDef != null && returnDef.getClassNames() != null) {
			classNames.addAll(returnDef.getClassNames());
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

	public Function queryById(String id) {
		Function function = null;
		try {
			List<Function> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ?",
					(rs, rowNum) -> mapRow(rs), id);
			if (!list.isEmpty()) {
				function = list.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return function;
	}

	public List<Function> queryList(String operation, String className, String domainId) {
		List<Function> functions = new ArrayList<Function>();
		try {
			StringBuilder whereSql = new StringBuilder("1 = 1");
			List<Object> params = new ArrayList<>();
			if (operation != null && !"".equals(operation.trim())) {
				whereSql.append(" AND operation = ?");
				params.add(operation.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			functions = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql + " ORDER BY modify_timestamp DESC",
					(rs, rowNum) -> mapRow(rs), params.toArray());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return functions;
	}

	private Function mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
		Function function = new Function();
		function.setId(rs.getString("id"));
		function.setName(rs.getString("name"));
		function.setOrigin(rs.getString("origin"));
		function.setDescription(rs.getString("description"));
		function.setOperation(rs.getString("operation"));
		String parameters = rs.getString("parameters");
		function.setParameters(parameters == null ? null : JSONArray.parseArray(parameters, Parameter.class));
		String returnDef = rs.getString("return_def");
		function.setReturnDef(returnDef == null ? null : JSONObject.parseObject(returnDef, ReturnDef.class));
		function.setCode(rs.getString("code"));
		function.setLogic(rs.getString("logic"));
		function.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		function.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		function.setDomainId(rs.getString("domain_id"));
		return function;
	}

}
