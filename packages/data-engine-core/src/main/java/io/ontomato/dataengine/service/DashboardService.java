package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.dashboard.DashboardCondition;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface DashboardService {
	
	public List<DashboardCondition> getConditionsFromDsls(List<JSONObject> originDsls, String domainId);
	
	public JSONObject getAnswerByDslConditionParam(JSONObject dsl, List<DashboardCondition> conditions, List<JSONObject> params, String lang, UserDataPermission permission, String domainId) throws Exception;
	
}
