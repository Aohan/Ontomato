package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.SandboxService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class SandboxServiceImpl implements SandboxService {
	
	@Autowired
	private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Override
	public void createNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.createNamespace(tmpNamespace);
	}

	@Override
	public void truncateNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.truncateNamespace(tmpNamespace);
		vectorResourceDao.truncateNamespace(getVectorNamespace(adapter.useM3(), tmpNamespace), domainId);
	}

	@Override
	public void dropNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.dropNamespace(tmpNamespace);
		vectorResourceDao.dropNamespace(getVectorNamespace(adapter.useM3(), tmpNamespace), domainId);
	}

	@Override
	public void createClass(String tmpNamespace, Map<String, Object> classDef, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.createClass(tmpNamespace, classDef);
		String vectorTableName = getVectorTableName(adapter.useM3(), tmpNamespace, classDef);
		for (String attrName : getVectorAttrNames(classDef)) {
			vectorResourceDao.rebuildIndex(vectorTableName, attrName, domainId);
		}
	}
	
	private String getVectorNamespace(boolean useM3, String tmpNamespace) {
		if (useM3) {
			return "/" + tmpNamespace + "/";
		} else {
			return tmpNamespace;
		}
	}
	
	private String getVectorTableName(boolean useM3, String tmpNamespace, Map<String, Object> classDef) {
		if (useM3) {
			String className = ((String) classDef.get("className")).trim().substring(1);
			className = className.substring(className.indexOf("/"));
			return "/" + tmpNamespace + className;
		} else {
			return tmpNamespace + ((String) classDef.get("className")).trim();
		}
	}
	
	private List<String> getVectorAttrNames(Map<String, Object> classDef) {
		List<String> attrNames = new ArrayList<String>();
		List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
		for (Map<String, Object> attrDef : attrDefs) {
			if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
				if ("vector".equals(attrDef.get("type"))) {
					attrNames.add((String)attrDef.get("name"));
				}
			}
		}
		return attrNames;
	}
	
	@Override
	public void createEdge(String tmpNamespace, String edgeName, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.createEdgeType(tmpNamespace, edgeName);
	}

	@Override
	public void insertObjects(String tmpNamespace, Map<String, Object> classDef, JSONArray objs, String domainId) throws Exception {
		if (objs == null || objs.size() == 0) {
			return;
		}
		
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.insertObjects(tmpNamespace, classDef, objs);
	}

	@Override
	public void insertRelations(String tmpNamespace, JSONArray rels, String domainId) throws Exception {
		if (rels != null) {
			DataAdapter adapter = getDataAdapter(domainId);
			
			for (int i = 0; i < rels.size(); i++) {
				JSONObject rel = rels.getJSONObject(i);
				String relationName = rel.getString("relationName");
				String sourceClassName = rel.getString("sourceClassName");
				String sourceObjId = rel.getString("sourceObjId");
				String targetClassName = rel.getString("targetClassName");
				String targetObjId = rel.getString("targetObjId");
				adapter.createEdge(tmpNamespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId);
			}
		}
	}
	
	private DataAdapter getDataAdapter(String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
		return adapter;
	}

}
