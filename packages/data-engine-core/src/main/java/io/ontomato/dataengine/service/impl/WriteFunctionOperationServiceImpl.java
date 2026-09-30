package io.ontomato.dataengine.service.impl;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.WriteFunctionOperationService;
import io.ontomato.dataengine.util.DslUtil;

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
	
	private boolean inSandbox(String sandboxId) {
		return sandboxId != null && !"".equals(sandboxId.trim());
	}
	
	/** Read the object's current vector attribute via a class def whose className already carries the sandbox prefix. */
	private JSONArray readVectorAttr(DataAdapter adapter, Map<String, Object> classDef, String prefixClassName, String attrName, String prefixObjectId) throws Exception {
		Map<String, Object> prefixClassDef = new HashMap<>(classDef);
		prefixClassDef.put("className", prefixClassName);
		return adapter.queryVectorAttr(prefixClassDef, attrName, prefixObjectId);
	}
	
	/** Write the object's vector attribute back through the plain class def + plain object id; the adapter re-applies the sandbox prefix. */
	private void writeVectorAttr(DataAdapter adapter, Map<String, Object> classDef, String attrName, String objectId, String sandboxId, JSONArray vectorAttr) throws Exception {
		String pkField = adapter.useM3() ? "id" : DslUtil.getPrimaryKey(classDef);
		JSONObject setValues = new JSONObject();
		setValues.put(attrName, vectorAttr);
		JSONObject where = new JSONObject();
		where.put("field", pkField);
		where.put("operator", "=");
		where.put("value", objectId);
		adapter.updateObjects(sandboxId, classDef, setValues, where);
	}
	
	@Override
	public void appendVector(String className, String attrName, String objectId, String content, InputStream is, String suffix, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef == null) {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
		DataAdapter adapter = getDataAdapter(domainId);
		boolean sandbox = inSandbox(sandboxId);
		String prefixClassName = sandbox ? adapter.sandboxClassName(sandboxId, className) : className;
		String prefixObjectId = sandbox ? adapter.sandboxObjectId(sandboxId, objectId) : objectId;
		
		VectorResource resource = new VectorResource();
		resource.setClassName(prefixClassName);
		resource.setAttrName(attrName);
		resource.setObjectId(prefixObjectId);
		resource.setContent(content);
		VectorResource saved = vectorResourceDao.insert(resource, is, suffix, domainId);
		if (saved == null) {
			throw new Exception("Failed to save vector resource for class [" + className + "] attr [" + attrName + "]");
		}
		
		JSONArray current = readVectorAttr(adapter, classDef, prefixClassName, attrName, prefixObjectId);
		JSONArray updated = new JSONArray();
		boolean exists = false;
		for (int i = 0; i < current.size(); i++) {
			JSONObject item = current.getJSONObject(i);
			if (saved.getPath().equals(item.getString("path"))) {
				exists = true;
			}
			updated.add(item);
		}
		if (!exists) {
			JSONObject newItem = new JSONObject();
			newItem.put("path", saved.getPath());
			newItem.put("text", content);
			updated.add(newItem);
		}
		writeVectorAttr(adapter, classDef, attrName, objectId, sandboxId, updated);
	}
	
	@Override
	public void updateVector(String className, String attrName, String objectId, String fileId, String content, InputStream is, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef == null) {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
		DataAdapter adapter = getDataAdapter(domainId);
		boolean sandbox = inSandbox(sandboxId);
		String prefixClassName = sandbox ? adapter.sandboxClassName(sandboxId, className) : className;
		String prefixObjectId = sandbox ? adapter.sandboxObjectId(sandboxId, objectId) : objectId;
		
		vectorResourceDao.update(prefixClassName, attrName, prefixObjectId, fileId, content, is, domainId);
		String path = vectorResourceDao.generatePath(prefixClassName, attrName, domainId, fileId);
		
		JSONArray current = readVectorAttr(adapter, classDef, prefixClassName, attrName, prefixObjectId);
		JSONArray updated = new JSONArray();
		for (int i = 0; i < current.size(); i++) {
			JSONObject item = current.getJSONObject(i);
			if (path.equals(item.getString("path"))) {
				item.put("text", content);
			}
			updated.add(item);
		}
		writeVectorAttr(adapter, classDef, attrName, objectId, sandboxId, updated);
	}
	
	@Override
	public void deleteVector(String className, String attrName, String objectId, String fileId, String sandboxId, String domainId) throws Exception {
		Map<String, Object> classDef = getClassDefByClassName(className, domainId);
		if (classDef == null) {
			throw new Exception(langService.get(businessConfigService.get(domainId).getLang(), "WriteFunctionOperation.classNotExist") + "[" + className + "]");
		}
		DataAdapter adapter = getDataAdapter(domainId);
		boolean sandbox = inSandbox(sandboxId);
		String prefixClassName = sandbox ? adapter.sandboxClassName(sandboxId, className) : className;
		String prefixObjectId = sandbox ? adapter.sandboxObjectId(sandboxId, objectId) : objectId;
		
		String path = vectorResourceDao.generatePath(prefixClassName, attrName, domainId, fileId);
		vectorResourceDao.delete(prefixClassName, attrName, prefixObjectId, path, domainId);
		
		JSONArray current = readVectorAttr(adapter, classDef, prefixClassName, attrName, prefixObjectId);
		JSONArray updated = new JSONArray();
		for (int i = 0; i < current.size(); i++) {
			JSONObject item = current.getJSONObject(i);
			if (!path.equals(item.getString("path"))) {
				updated.add(item);
			}
		}
		writeVectorAttr(adapter, classDef, attrName, objectId, sandboxId, updated);
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
