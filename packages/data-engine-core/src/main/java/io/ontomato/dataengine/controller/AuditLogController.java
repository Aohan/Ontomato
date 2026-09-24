package io.ontomato.dataengine.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.AuditLogService;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
public class AuditLogController {

	@Autowired
	private AuditLogService auditLogService;
	
	@PostMapping("/auditLog/queryPage")
    @ResponseBody
    public Page<AuditLog> queryPage(@RequestBody JSONObject param) {
    	int pageNum = param.getInteger("pageNum");
    	int pageSize = param.getInteger("pageSize");
    	String bussiness = param.getString("bussiness");
    	String operation = param.getString("operation");
        User user = SystemUtils.getCurUser();

        return auditLogService.queryPage(pageNum, pageSize, bussiness, operation, user.getDomainId());
    }
	
}
