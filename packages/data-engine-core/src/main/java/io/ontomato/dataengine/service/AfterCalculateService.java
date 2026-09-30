package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AfterCalculatorResult;

import java.io.File;
import java.util.List;
import java.util.Map;

public interface AfterCalculateService {
	
	public String getSubQueryCacheDirName();

	public Map<String, Object> subQueryResultToCacheFile(String sessionId, int index, JSONObject dataMap, JSONObject rowPermissionDataMap, String domainId);
	
	public File getSubQueryCacheFile(String fileName);

	public AfterCalculatorResult calculate(String sessionid, String calculateQuestion, List<Map> jsonSchema, String originSessionId, String lang, String domainId);

}
