package io.ontomato.dataengine.service;

import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

public interface WriteFunctionOperationService {

	public void insert(String className, JSONArray objs, String sandboxId, String domainId) throws Exception;
	
	public void update(String className, JSONObject setValues, JSONObject where, String sandboxId, String domainId) throws Exception;
	
	public void delete(String className, JSONObject where, String sandboxId, String domainId) throws Exception;
	
	public void createEdge(String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId, String sandboxId, String domainId) throws Exception;
	
	public void deleteEdge(String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId, String sandboxId, String domainId) throws Exception;
	
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId) throws Exception;
	
}
