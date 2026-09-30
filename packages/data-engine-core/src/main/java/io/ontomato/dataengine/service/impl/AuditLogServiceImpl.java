package io.ontomato.dataengine.service.impl;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.service.AuditLogService;

@Service
public class AuditLogServiceImpl implements AuditLogService {
	
	@Autowired
	private AuditLogDao auditLogDao;

	@Override
	public Page<AuditLog> queryPage(int pageNum, int pageSize, String bussiness, String operation, String domainId) {
		if (pageNum < 1) {
			pageNum = 1;
		}
		if (pageSize < 0) {
			pageSize = 20;
		}
		if (pageSize > 100) {
			pageSize = 100;
		}
		return auditLogDao.queryPage(pageNum, pageSize, bussiness, operation, domainId);
	}

}
