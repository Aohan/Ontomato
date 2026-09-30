package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;

public interface AuditLogService {

	public Page<AuditLog> queryPage(int pageNum, int pageSize, String bussiness, String operation, String domainId);
	
}
