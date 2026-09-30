package io.ontomato.dataengine.service.impl;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DslService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;
import io.ontomato.dataengine.util.HttpRequestUtil.M3Mode;

@Service
public class DslServiceImpl implements DslService {
	
	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
	private DataPermissionLookup dataPermissionLookup;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Override
	public Map<String, Object> executeV0(JSONObject dsl, UserDataPermission permission, User user) {
		DslUtil.setRandomTempTableName(dsl);
    	return getM3Data(dsl, permission, M3Mode.V0, user);
	}
	
	private Map<String, Object> getM3Data(JSONObject dsl, UserDataPermission permission, M3Mode m3Mode, User user) {
		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		JSONArray dsls = new JSONArray();
    	dsls.add(dsl);
		Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
		DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), null, true, jsonRule, vectorResourceDao, permission, m3Mode, user.getDomainId());
		return results[1].rawResponse();
	}

	@Override
	public Map<String, Object> executeV1(JSONObject dsl, UserDataPermission permission, User user) {
		return executeNormalized(dsl, permission, user.getDomainId());
	}
	
	@Override
	public List<String> getNodeIds(JSONObject dsl, UserDataPermission permission, User user) {
		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		JSONArray dsls = new JSONArray();
    	dsls.add(dsl);
		Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
    	List<String> nodeIds = HttpRequestUtil.getNodeIds(dataAdapterRegistry.create(businessConfig, jsonRule), JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), jsonRule, vectorResourceDao, permission, user.getDomainId());
    	return nodeIds;
	}

	@Override
	public Map<String, Object> executeForABCProgrammer(JSONObject dsl, String userId, String domainId) {
		UserDataPermission userDataPermission = null;
		if ("admin".equals(userId)) {
			userDataPermission = new UserDataPermission();
		} else {
			userDataPermission = dataPermissionLookup.getDataPermission(userId, domainId);
		}
		return executeNormalized(dsl, userDataPermission, domainId);
	}

	/** Shared by executeV1 and executeForABCProgrammer: normalize class names and time conditions, return data plus a short error text. */
	private Map<String, Object> executeNormalized(JSONObject dsl, UserDataPermission permission, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		JSONArray dsls = new JSONArray();
    	dsls.add(dsl);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs);
    	
		DslExecutionResult result = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), dslStr, null, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId)[1];
		JSONObject dataMap = new JSONObject();
		dataMap.putAll(result.data());
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

}
