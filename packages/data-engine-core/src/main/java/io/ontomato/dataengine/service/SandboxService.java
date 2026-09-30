package io.ontomato.dataengine.service;

import java.util.Map;

import com.alibaba.fastjson2.JSONArray;

public interface SandboxService {
	
	public void createNamespace(String tmpNamespace, String domainId);

	public void truncateNamespace(String tmpNamespace, String domainId);
	
	public void dropNamespace(String tmpNamespace, String domainId);
	
	public void createClass(String tmpNamespace, Map<String, Object> classDef, String domainId);
	
	public void createEdge(String tmpNamespace, String edgeName, String domainId);
	
	public void insertObjects(String tmpNamespace, Map<String, Object> classDef, JSONArray objs, String domainId) throws Exception;
	
	public void insertRelations(String tmpNamespace, JSONArray rels, String domainId) throws Exception;
	
}
