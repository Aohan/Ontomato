package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

public interface JSONCorrector {

	public JSONObject parseObject(String str, String domainId, String sessionId);
	
	public JSONArray parseArray(String str, String domainId, String sessionId);
	
}
