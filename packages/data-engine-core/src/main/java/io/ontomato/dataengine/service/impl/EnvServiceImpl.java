package io.ontomato.dataengine.service.impl;

import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.utils.ProductionLoginCipher;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.EnvService;
import io.ontomato.dataengine.service.ProductionEnvironmentLoginPolicy;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;
import io.ontomato.dataengine.service.SchemaImportAuthorization;
import io.ontomato.dataengine.service.SchemaPermissionService;

@Slf4j
@Service
public class EnvServiceImpl implements EnvService {
	
	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private AdminService adminService;
	
	@Autowired
	private SchemaPermissionService schemaPermissionService;

	@Autowired
	private ProductionEnvironmentLoginPolicy productionEnvironmentLoginPolicy;

	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Override
	public void importSchema(User user) throws Exception {
		String domainId = user.getDomainId();
		
		String tk = null;
		try {
			tk = getProductionEnvTk();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Login to the production environment failed");
		}
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("tk", tk);
		String result = HttpRequestUtil.getProductionEnv(dataRagConfig.getProductionEnvUrl() + "/admin/getSchema", headers);
		JSONObject ret = JSONObject.parseObject(result);
		if (ret.getBoolean("success")) {
			SchemaImportAuthorization authorization = schemaPermissionService.prepareImport(user);
			
			// Write jsonRule and supplement primaryKey at the same time
			JSONObject prettyJsonRule = ret.getJSONObject("data");
			JSONArray prettyClassDefs = prettyJsonRule.getJSONArray("classDefs");
			for (int i = 0; i < prettyClassDefs.size(); i++) {
				JSONObject prettyClassDef = prettyClassDefs.getJSONObject(i);
				JSONArray attrDefs = prettyClassDef.getJSONArray("attrs");
				boolean hasPk = false;
				JSONObject firstAttrDef = null;
				for (int j = 0; j < attrDefs.size(); j++) {
					JSONObject attrDef = attrDefs.getJSONObject(j);
					if (attrDef.getBoolean("enable") == null || attrDef.getBoolean("enable")) {
						if (attrDef.getBoolean("primaryKey") != null && attrDef.getBoolean("primaryKey")) {
							hasPk = true;
						}
						if (firstAttrDef == null) {
							firstAttrDef = attrDef;
						}
					}
				}
				if (!hasPk) {
					if (firstAttrDef != null) {
						firstAttrDef.put("primaryKey", true);
					}
				}
			}
			adminService.setPrettyJSONRule(prettyJsonRule, domainId);
			
			// Create namespace
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			String namespace = ((String)classDefs.get(0).get("className")).trim();
			if (namespace.startsWith("/")) {
				namespace = namespace.substring(1);
				namespace = namespace.substring(0, namespace.indexOf("/"));
			} else {
				namespace = null;
			}
			BusinessConfig businessConfig = businessConfigService.get(domainId);
			DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
			adapter.truncateNamespace(namespace);
			adapter.dropNamespace(namespace);
			adapter.createNamespace(namespace);
			vectorResourceDao.clearByDomain(domainId);
			// Create class
			for (Map<String, Object> classDef : classDefs) {
				adapter.createClass(namespace == null ? "" : namespace, classDef);
			}
			// Create relationship
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			for (String key : relationship_rule.keySet()) {
				adapter.createEdgeType(namespace, key.trim());
			}
			
			schemaPermissionService.grantImport(authorization, classDefs);
		} else {
			throw new Exception("Failed to get class and relationship definitions of the production environment");
		}
	}
	
	private String getProductionEnvTk() throws Exception {
		if (!productionEnvironmentLoginPolicy.shouldLogin(dataRagConfig.getProductionEnvUser())) {
			return "";
		}
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("Content-Type", "application/json;charset=utf-8");
		JSONObject param = new JSONObject();
		param.put("loginCode", ProductionLoginCipher.encrypt(dataRagConfig.getProductionEnvUser()));
		param.put("password", ProductionLoginCipher.encrypt(dataRagConfig.getProductionEnvPwd()));
		String result = HttpRequestUtil.postProductionEnv(dataRagConfig.getProductionEnvUrl() + "/sso/doLogin", headers, param);
		JSONObject ret = JSONObject.parseObject(result);
		return ret.getJSONObject("data").getString("tk");
	}
	

	@Override
	public void importTestData(InputStream is, String domainId) throws Exception {
		JSONObject data = JSONObject.parseObject(new String(is.readAllBytes(), "utf-8"));
		JSONArray objDatas = data.getJSONArray("objDatas");
		JSONArray relDatas = data.getJSONArray("relDatas");
		
		// Check object data
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
		for (Map<String, Object> classDef : classDefs) {
			classDefMap.put((String)classDef.get("className"), classDef);
		}
		Map<String, Set<String>> classIdsMap = new HashMap<String, Set<String>>();
		for (int i = 0; i < objDatas.size(); i++) {
			JSONObject objData = objDatas.getJSONObject(i);
			String className = objData.getString("className");
			Map<String, Object> classDef = classDefMap.get(className);
			if (classDef != null) {
				Set<String> attrNameSet = new HashSet<String>();
				Set<String> vectorAttrs = new HashSet<String>();
				String pk = "id";
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
						String attrName = (String)attrDef.get("name");
						attrNameSet.add(attrName);
						if ("vector".equals(attrDef.get("type"))) {
							vectorAttrs.add(attrName);
						}
						if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
							pk = attrName;
						}
					}
				}
				Set<String> ids = new HashSet<String>();
				JSONArray rows = objData.getJSONArray("rows");
				for (int j = 0; j < rows.size(); j++) {
					JSONObject row = rows.getJSONObject(j);
					for (String key : row.keySet()) {
						if (!attrNameSet.contains(key)) {
							throw new Exception("The row of Class[" + className + "] has a property[" + key + "], but that property does not belong to Class[" + className + "].");
						}
						if (vectorAttrs.contains(key)) {
							Object val = row.get(key);
							if (val != null && !(val instanceof String s && s.trim().isEmpty())) {
								throw new Exception("The row of Class[" + className + "] has a vector property[" + key + "] with non-empty value, but vector properties can only be written via the upload interface.");
							}
						}
					}
					if (row.get(pk) != null && !"".equals(row.getString(pk).trim())) {
						String id = row.getString(pk);
						for (String cn : classIdsMap.keySet()) {
							if (classIdsMap.get(cn).contains(id)) {
								throw new Exception("Property[" + pk + "]: " + id + ", is duplicated.");
							}
						}
						if (ids.contains(id)) {
							throw new Exception("Property[" + pk + "]: " + id + ", is duplicated.");
						}
						ids.add(id);
					} else {
						throw new Exception("The row of Class[" + className + "] has not primary key property[" + pk + "], or the value of primary key property[" + pk + "] is null or empty string.");
					}
				}
				classIdsMap.put(className, ids);
			} else {
				throw new Exception("Class[" + className + "] is not exist.");
			}
		}
		
		// Check relationship data
		JSONArray newRelDatas = new JSONArray();
		Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
		for (int i = 0; i < relDatas.size(); i++) {
			JSONObject relData = relDatas.getJSONObject(i);
			String relationName = relData.getString("relationName");
			String sourceObjId = relData.getString("sourceObjId");
			String targetObjId = relData.getString("targetObjId");
			
			if (relationship_rule.get(relationName) != null) {
				Map<String, String> relationDef = (Map<String, String>)relationship_rule.get(relationName);
				String fromClass = relationDef.get("fromclass");
				String toClass = relationDef.get("toclass");
				Set<String> fromIds = classIdsMap.get(fromClass);
				if (fromIds == null || !fromIds.contains(sourceObjId)) {
					throw new Exception("The relation data: {relationName:" + relationName + ", sourceObjId: " + sourceObjId + ", targetObjId: " + targetObjId + "}, sourceObjId[" + sourceObjId + "] is not in Class[" + fromClass + "].");
				}
				Set<String> toIds = classIdsMap.get(toClass);
				if (toIds == null || !toIds.contains(targetObjId)) {
					throw new Exception("The relation data: {relationName:" + relationName + ", sourceObjId: " + sourceObjId + ", targetObjId: " + targetObjId + "}, targetObjId[" + targetObjId + "] is not in Class[" + toClass + "].");
				}
				JSONObject newRelData = new JSONObject();
				newRelData.put("relationName", relationName);
				newRelData.put("sourceClassName", fromClass);
				newRelData.put("sourceObjId", sourceObjId);
				newRelData.put("targetClassName", toClass);
				newRelData.put("targetObjId", targetObjId);
				newRelDatas.add(newRelData);
			} else {
				throw new Exception("Relation[" + relationName + "] is not exist.");
			}
		}
		
		// Import data
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);
		for (int i = 0; i < objDatas.size(); i++) {
			JSONObject objData = objDatas.getJSONObject(i);
			String className = objData.getString("className").trim();
			JSONArray objs = objData.getJSONArray("rows");
			// Clear old data
			Map<String, Object> classDef = classDefMap.get(className);
			adapter.deleteObjects(null, classDef, null);
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if ("vector".equals(attrDef.get("type"))) {
					vectorResourceDao.clear(className, (String) attrDef.get("name"), domainId);
				}
			}
			// Insert data
			adapter.insertObjects(null, classDef, objs);
		}
		
		for (int i = 0; i < newRelDatas.size(); i++) {
			JSONObject rel = newRelDatas.getJSONObject(i);
			String relationName = rel.getString("relationName");
			String sourceClassName = rel.getString("sourceClassName");
			String sourceObjId = rel.getString("sourceObjId");
			String targetClassName = rel.getString("targetClassName");
			String targetObjId = rel.getString("targetObjId");
			adapter.createEdge(null, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId);
		}
	}

	@Override
	public JSONObject executeDslInProductionEnv(JSONObject dsl) throws Exception {
		String tk = null;
		try {
			tk = getProductionEnvTk();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Login to the production environment failed");
		}
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("Content-Type", "application/json;charset=utf-8");
		headers.put("tk", tk);
		String result = HttpRequestUtil.postProductionEnv(dataRagConfig.getProductionEnvUrl() + "/dsl/executeV1", headers, dsl);
		return JSONObject.parseObject(result);
	}

	@Override
	public String queryDistinctAttrValueInProductionEnv(String className, String attrName, String like, int limit)
			throws Exception {
		String tk = null;
		try {
			tk = getProductionEnvTk();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Login to the production environment failed");
		}
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("Content-Type", "application/json;charset=utf-8");
		headers.put("tk", tk);
		JSONObject param = new JSONObject();
		param.put("className", className);
		param.put("attrName", attrName);
		param.put("like", like);
		param.put("limit", limit);
		String result = HttpRequestUtil.postProductionEnv(dataRagConfig.getProductionEnvUrl() + "/admin/queryDistinctAttrValue", headers, param);
		JSONObject ret = JSONObject.parseObject(result);
		if (ret.getBoolean("success")) {
			return ret.getString("data");
		} else {
			throw new Exception("Failed to get");
		}
	}

	@Override
	public String queryBusinessKnowledgeInProductionEnv(String question, Integer max_result) throws Exception {
		String tk = null;
		try {
			tk = getProductionEnvTk();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Login to the production environment failed");
		}
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("Content-Type", "application/json;charset=utf-8");
		headers.put("tk", tk);
		JSONObject param = new JSONObject();
		param.put("question", question);
		if (max_result != null) {
			param.put("max_result", max_result);
		}
		String result = HttpRequestUtil.postProductionEnv(dataRagConfig.getProductionEnvUrl() + "/knowledge/findknowledge", headers, param);
		return result;
	}

}
