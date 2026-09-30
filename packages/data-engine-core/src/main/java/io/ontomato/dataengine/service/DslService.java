package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface DslService {

	public Map<String, Object> executeV0(JSONObject dsl, UserDataPermission permission, User user);
	
	public Map<String, Object> executeV1(JSONObject dsl, UserDataPermission permission, User user);
	
	public List<String> getNodeIds(JSONObject dsl, UserDataPermission permission, User user);
	
	public Map<String, Object> executeForABCProgrammer(JSONObject dsl, String userId, String domainId);
	
}
