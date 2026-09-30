package io.ontomato.dataengine.service;

import java.io.InputStream;
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
	
	public void appendVector(String className, String attrName, String objectId, String content, InputStream is, String suffix, String sandboxId, String domainId) throws Exception;
	
	public void updateVector(String className, String attrName, String objectId, String fileId, String content, InputStream is, String sandboxId, String domainId) throws Exception;
	
	public void deleteVector(String className, String attrName, String objectId, String fileId, String sandboxId, String domainId) throws Exception;
	
}
