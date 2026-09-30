package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("auditLogDao")
public class AuditLogDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "audit_log";

	private static final String COLUMNS = "id, domain_id, bussiness, by_ai, user_id, user_name, operation, description, paramter, operate_time";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "domain_id VARCHAR(64), "
				+ "bussiness VARCHAR(64), "
				+ "by_ai BOOLEAN, "
				+ "user_id VARCHAR(64), "
				+ "user_name VARCHAR(255), "
				+ "operation VARCHAR(64), "
				+ "description TEXT, "
				+ "paramter TEXT, "
				+ "operate_time BIGINT"
				+ ")");
		log.info(">>>auditLog table initialization complete");
	}

	public void save(AuditLog auditLog, String domainId) {
		auditLog.setDomainId(domainId);
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET domain_id = EXCLUDED.domain_id, bussiness = EXCLUDED.bussiness, "
						+ "by_ai = EXCLUDED.by_ai, user_id = EXCLUDED.user_id, user_name = EXCLUDED.user_name, "
						+ "operation = EXCLUDED.operation, description = EXCLUDED.description, "
						+ "paramter = EXCLUDED.paramter, operate_time = EXCLUDED.operate_time",
				auditLog.getId(), auditLog.getDomainId(), auditLog.getBussiness(), auditLog.getByAi(),
				auditLog.getUserId(), auditLog.getUserName(), auditLog.getOperation(),
				auditLog.getDescription(), auditLog.getParamter(), auditLog.getOperateTime());
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ?", id);
	}

	public Page<AuditLog> queryPage(int pageNum, int pageSize, String bussiness, String operation, String domainId) {
		Page<AuditLog> page = new Page<AuditLog>();
		page.setPageNum(pageNum);
		page.setPageSize(pageSize);

		try {
			StringBuilder whereSql = new StringBuilder();
			List<Object> params = new ArrayList<>();

			// domainId is a required filter condition
			whereSql.append("domain_id = ?");
			params.add(domainId);

			if (bussiness != null && !"".equals(bussiness.trim())) {
				whereSql.append(" AND bussiness = ?");
				params.add(bussiness.trim());
			}
			if (operation != null && !"".equals(operation.trim())) {
				whereSql.append(" AND operation = ?");
				params.add(operation.trim());
			}

			String countSql = "SELECT COUNT(*) FROM " + TABLE_NAME + " WHERE " + whereSql;
			String dataSql = "SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql
					+ " ORDER BY operate_time DESC LIMIT ? OFFSET ?";

			Long totalRows = jdbcTemplate.queryForObject(countSql, Long.class, params.toArray());
			if (totalRows == null) {
				totalRows = 0L;
			}

			List<Object> dataParams = new ArrayList<>(params);
			dataParams.add(pageSize);
			dataParams.add((pageNum - 1) * pageSize);

			List<AuditLog> auditLogs = jdbcTemplate.query(dataSql, (rs, rowNum) -> {
				AuditLog log = new AuditLog();
				log.setId(rs.getString("id"));
				log.setDomainId(rs.getString("domain_id"));
				log.setBussiness(rs.getString("bussiness"));
				log.setByAi(rs.getBoolean("by_ai"));
				log.setUserId(rs.getString("user_id"));
				log.setUserName(rs.getString("user_name"));
				log.setOperation(rs.getString("operation"));
				log.setDescription(rs.getString("description"));
				log.setParamter(rs.getString("paramter"));
				log.setOperateTime((Long) rs.getObject("operate_time"));
				return log;
			}, dataParams.toArray());

			page.setTotalRows(totalRows);
			page.setTotalPages(totalRows % pageSize == 0 ? (totalRows / pageSize) : (totalRows / pageSize + 1));
			page.setData(auditLogs);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return page;
	}

}
