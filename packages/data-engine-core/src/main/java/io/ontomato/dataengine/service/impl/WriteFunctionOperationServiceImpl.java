package io.ontomato.dataengine.service.impl;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.WriteFunctionOperationService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class WriteFunctionOperationServiceImpl implements WriteFunctionOperationService {
	
	@Autowired
	private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private LangService langService;
	
	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Override
	public void insert(String className, JSONArray objs, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef != null) {
			DataAdapter adapter = getDataAdapter(domainId);
			adapter.insertObjects(sandboxId, classDef, objs);
		} else {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
	}
	
	private Map<String, Object> getClassDefByClassName(String className, String domainId) {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className)) {
				classDef = cd;
				break;
			}
		}
		return classDef;
	}

	@Override
	public void update(String className, JSONObject setValues, JSONObject where, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef != null) {
			DataAdapter adapter = getDataAdapter(domainId);
			adapter.updateObjects(sandboxId, classDef, setValues, where);
		} else {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
	}

	@Override
	public void delete(String className, JSONObject where, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef != null) {
			DataAdapter adapter = getDataAdapter(domainId);
			adapter.deleteObjects(sandboxId, classDef, where);
		} else {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
	}

	@Override
	public void createEdge(String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId, String sandboxId, String domainId) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
		if (relationship_rule.get(relationName) != null) {
			DataAdapter adapter = getDataAdapter(domainId, jsonRule);
			adapter.createEdge(sandboxId, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId);
		} else {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.relationNotExist") + "[" + relationName + "]");
		}
	}

	@Override
	public void deleteEdge(String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId, String sandboxId, String domainId) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
		if (relationship_rule.get(relationName) != null) {
			DataAdapter adapter = getDataAdapter(domainId, jsonRule);
			adapter.deleteEdge(sandboxId, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId);
		} else {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.relationNotExist") + "[" + relationName + "]");
		}
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		DataAdapter adapter = getDataAdapter(domainId, jsonRule);
		return adapter.query(dsl, sandboxId, domainId, vectorResourceDao, dataRagConfig);
	}
	
	private DataAdapter getDataAdapter(String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
		return adapter;
	}
	
	private DataAdapter getDataAdapter(String domainId, Map<String, Object> jsonRule) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);
		return adapter;
	}

}
