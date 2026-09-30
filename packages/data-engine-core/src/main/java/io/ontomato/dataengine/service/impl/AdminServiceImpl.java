package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import io.ontomato.dataengine.service.BussinessExampleService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.QueryExampleConfigDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.util.FileUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;
import io.ontomato.dataengine.util.SystemUtils;

import cn.hutool.core.lang.UUID;

@Slf4j
@Service
public class AdminServiceImpl implements AdminService {

	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private JSONRuleDao jsonRuleDao;

	@Autowired
	private KnowledgeService knowledgeService;

	@Autowired
	private BussinessExampleService bussinessExampleService;
	
	@Autowired
	private LangService langService;
	
	@Autowired
    private AuditLogDao auditLogDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Autowired
	private QueryExampleConfigDao queryExampleConfigDao;

	@Override
	public void setDataSetDesc(String dataSetDesc, User user) {
		if (dataSetDesc !=null && !"".equals(dataSetDesc)) {
			Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
			jsonRule.put("datasetdesc", dataSetDesc);
			writeJSONRule(jsonRule, user.getDomainId());
			log.info("datasetdesc: " + dataSetDesc);
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_UPD);
	        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.datasetDesc.upd") + ": " + dataSetDesc);
	        auditLog.setParamter(dataSetDesc);
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		}
	}
	
	@Override
	public void addRelationship(String relationName, String fromClassName, String toClassName, String relationDesc, String fromField, String toField, String lang, User user) throws Exception {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Map<String, String>> relationship_rule = (Map<String, Map<String, String>>)jsonRule.get("relationship_rule");
		relationName = relationName.trim();
		if (relationName.indexOf(" ") >= 0) {
			throw new Exception(langService.get(lang, "Admin.relationship.nameError"));
		}
		if (relationship_rule.get(relationName) == null) {
			boolean existFrom = false;
			boolean existTo = false;
			for (Map<String, Object> classDef : classDefs) {
				if (fromClassName.equals(classDef.get("className"))) {
					existFrom = true;
				}
				if (toClassName.equals(classDef.get("className"))) {
					existTo = true;
				}
			}
			if (!existFrom) {
				throw new Exception(langService.get(lang, "Admin.relationship.fromClassNotFound"));
			}
			if (!existTo) {
				throw new Exception(langService.get(lang, "Admin.relationship.toClassNotFound"));
			}
			
			validatePrimaryKey(jsonRule);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
			if (adapter.useM3()) {
				String namespace = fromClassName.substring(1);
				namespace = namespace.substring(0, namespace.indexOf("/")).trim();
				String mql = "create edge type if not exists " + namespace + "." + relationName + " ;";
				HttpRequestUtil.getExecMQL(dataRagConfig, mql);
			}
			
			
			Map<String, String> relationshipDef = new HashMap<String, String>();
			relationshipDef.put("fromclass", fromClassName);
			relationshipDef.put("toclass", toClassName);
			relationshipDef.put("desc", relationDesc);
			relationshipDef.put("fromField", fromField);
			relationshipDef.put("toField", toField);
			relationshipDef.put("fromdesc", "");
			relationshipDef.put("todesc", "");
			relationship_rule.put(relationName, relationshipDef);
			writeJSONRule(jsonRule, user.getDomainId());
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_ADD);
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.relationship.add") + ": " + relationName);
	        auditLog.setParamter(JSONObject.toJSONString(relationshipDef));
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		} else {
			throw new Exception(langService.get(lang, "Admin.relationship.exist"));
		}
	}
	
	@Override
	public void delRelationship(String relationName, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		Map<String, Map<String, String>> relationship_rule = (Map<String, Map<String, String>>)jsonRule.get("relationship_rule");
		if (relationship_rule.get(relationName) != null) {
			relationship_rule.remove(relationName);
			writeJSONRule(jsonRule, user.getDomainId());
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_DEL);
	        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.relationship.del") + ": " + relationName);
	        auditLog.setParamter(relationName);
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		}
	}
	
	@Override
	public void setRelationshipDesc(String relationship, String desc, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		Map<String, Map<String, String>> relationship_rule = (Map<String, Map<String, String>>)jsonRule.get("relationship_rule");
		Map<String, String> relationshipDef = relationship_rule.get(relationship);
		if (relationshipDef != null) {
			relationshipDef.put("desc", desc);
			writeJSONRule(jsonRule, user.getDomainId());
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_UPD);
	        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.relationship.upd") + ": " + relationship);
	        auditLog.setParamter(JSONObject.toJSONString(relationshipDef));
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		}
	}
	
	@Override
	public void addClass(String className, String primaryKeyName, String showName, String classDesc, boolean classToCard, boolean instanceToCard, boolean inStarChart, String lang, User user) throws Exception {
		className = className.trim();
		if (primaryKeyName == null || primaryKeyName.isBlank()) {
			throw new Exception(langService.get(lang, "Admin.class.primaryKeyRequired"));
		}
		// strip() drops only whitespace, like the Manager's trim(); control characters stay and fail the rule below.
		primaryKeyName = primaryKeyName.strip();
		// Same rule as the Manager's attribute names; the name is written into the model and, on M3, into DDL.
		if (!primaryKeyName.matches("[A-Za-z_][A-Za-z0-9_]*")) {
			throw new Exception(langService.get(lang, "Admin.attr.formatError"));
		}
		
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);
		adapter.validateClassNameFormat(className);
		// An M3 object is keyed by its id field (key=manu); the model must not name another field as the key.
		if (adapter.useM3() && !"id".equals(primaryKeyName)) {
			throw new Exception(langService.get(lang, "Admin.class.m3PrimaryKeyId"));
		}
		
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		boolean exist = false;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				exist = true;
				break;
			}
		}
		if (!exist) {
			Map<String, Object> primaryKey = new HashMap<String, Object>();
			primaryKey.put("name", primaryKeyName);
			primaryKey.put("showName", primaryKeyName);
			primaryKey.put("attrDesc", "");
			primaryKey.put("type", "varchar");
			primaryKey.put("bizzkey", false);
			primaryKey.put("enable", true);
			primaryKey.put("permissionField", false);
			primaryKey.put("primaryKey", true);
			List<Map<String, Object>> attrs = new ArrayList<Map<String, Object>>();
			attrs.add(primaryKey);
			
			Map<String, Object> classDef = new HashMap<String, Object>();
			classDef.put("className", className);
			classDef.put("showName", showName);
			classDef.put("classDesc", classDesc);
			classDef.put("classToCard", classToCard);
			classDef.put("instanceToCard", instanceToCard);
			classDef.put("inStarChart", inStarChart);
			classDef.put("attrs", attrs);
			classDefs.add(classDef);
			List<String> classList = (List<String>)jsonRule.get("classlist");
			if (!classList.contains(className)) {
				classList.add(className);
			}
			validatePrimaryKey(jsonRule);
			if (adapter.useM3()) {
				String mql = "create class if not exists " + className + " ( id varchar ) with autosearch=true, version=false, key=manu, alias='" + classDesc + "' , nickname='" + className.substring(1).replace("/", "_") + "';";
				HttpRequestUtil.getExecMQL(dataRagConfig, mql);
			}
			writeJSONRule(jsonRule, user.getDomainId());
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_ADD);
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.class.add") + ": " + className);
	        auditLog.setParamter(JSONObject.toJSONString(classDef));
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		} else {
			throw new Exception(langService.get(lang, "Admin.class.exist"));
		}
	}
	
	@Override
	public void delClass(String className, User user) {
		className = className.trim();
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		int removeIndex = -1;
		for (int i = 0; i < classDefs.size(); i++) {
			Map<String, Object> classDef = classDefs.get(i);
			if (classDef.get("className").equals(className)) {
				removeIndex = i;
				break;
			}
		}
		if (removeIndex >= 0) {
			classDefs.remove(removeIndex);
			List<String> classList = (List<String>)jsonRule.get("classlist");
			classList.remove(className);
			validatePrimaryKey(jsonRule);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
			if (adapter.useM3()) {
				JSONArray classExistRet = HttpRequestUtil.getExecMQL(dataRagConfig, "select name from /system/class where name='" + className + "'");
				if (classExistRet.size() > 0) {
					JSONArray objCountRet = HttpRequestUtil.getExecMQL(dataRagConfig, "select count(id) as c from " + className + "");
					Integer objCount = objCountRet.getJSONObject(0).getInteger("c");
					if (objCount == 0) {
						String mql = "drop class " + className + ";";
						HttpRequestUtil.getExecMQL(dataRagConfig, mql);
					}
				}
			}
			
			writeJSONRule(jsonRule, user.getDomainId());
			
			AuditLog auditLog = new AuditLog();
			auditLog.setId(UUID.randomUUID().toString());
	        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
	        auditLog.setByAi(false);
	        auditLog.setUserId(user.getId());
	        auditLog.setUserName(user.getUserName());
	        auditLog.setOperation(AuditLog.OPERATION_DEL);
	        String sysLang = businessConfig.getLang();
	        auditLog.setDescription(langService.get(sysLang, "AuditLog.class.del") + ": " + className);
	        auditLog.setParamter(className);
	        auditLog.setOperateTime(System.currentTimeMillis());
	        auditLogDao.save(auditLog, user.getDomainId());
		}
	}

	@Override
	public void setClassDesc(String className, String desc, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				classDef.put("classDesc", desc);
				writeJSONRule(jsonRule, user.getDomainId());
				
				AuditLog auditLog = new AuditLog();
				auditLog.setId(UUID.randomUUID().toString());
		        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		        auditLog.setByAi(false);
		        auditLog.setUserId(user.getId());
		        auditLog.setUserName(user.getUserName());
		        auditLog.setOperation(AuditLog.OPERATION_UPD);
		        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		        String sysLang = businessConfig.getLang();
		        auditLog.setDescription(langService.get(sysLang, "AuditLog.class.upd") + ": " + className);
		        auditLog.setParamter(JSONObject.toJSONString(classDef));
		        auditLog.setOperateTime(System.currentTimeMillis());
		        auditLogDao.save(auditLog, user.getDomainId());
				break;
			}
		}
	}
	
	@Override
	public void setClassShowName(String className, String showName, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				classDef.put("showName", showName);
				writeJSONRule(jsonRule, user.getDomainId());
				
				AuditLog auditLog = new AuditLog();
				auditLog.setId(UUID.randomUUID().toString());
		        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		        auditLog.setByAi(false);
		        auditLog.setUserId(user.getId());
		        auditLog.setUserName(user.getUserName());
		        auditLog.setOperation(AuditLog.OPERATION_UPD);
		        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		        String sysLang = businessConfig.getLang();
		        auditLog.setDescription(langService.get(sysLang, "AuditLog.class.upd") + ": " + className);
		        auditLog.setParamter(JSONObject.toJSONString(classDef));
		        auditLog.setOperateTime(System.currentTimeMillis());
		        auditLogDao.save(auditLog, user.getDomainId());
				break;
			}
		}
	}
	
	@Override
	public void setClassInStarChart(String className, boolean inStarChart, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				classDef.put("inStarChart", inStarChart);
				writeJSONRule(jsonRule, user.getDomainId());
				
				AuditLog auditLog = new AuditLog();
				auditLog.setId(UUID.randomUUID().toString());
		        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		        auditLog.setByAi(false);
		        auditLog.setUserId(user.getId());
		        auditLog.setUserName(user.getUserName());
		        auditLog.setOperation(AuditLog.OPERATION_UPD);
		        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		        String sysLang = businessConfig.getLang();
		        auditLog.setDescription(langService.get(sysLang, "AuditLog.class.upd") + ": " + className);
		        auditLog.setParamter(JSONObject.toJSONString(classDef));
		        auditLog.setOperateTime(System.currentTimeMillis());
		        auditLogDao.save(auditLog, user.getDomainId());
				break;
			}
		}
	}
	
	@Override
	public void addClassAttr(String className, String attrName, String showName, String attrDesc, String type, boolean bizzKey, boolean enable, String lang, User user) throws Exception {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className.trim())) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			boolean exist = false;
			for (Map<String, Object> attrDef : attrs) {
				if (attrDef.get("name").equals(attrName.trim())) {
					exist = true;
					break;
				}
			}
			if (!exist) {
				attrName = attrName.trim();
				if (attrName.indexOf(" ") >= 0) {
					throw new Exception(langService.get(lang, "Admin.attr.formatError"));
				}
				// Adding a field never changes the primary key; a rule already breaking it is refused before the DDL.
				validatePrimaryKey(jsonRule);
				BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
				if (adapter.useM3()) {
					JSONArray fieldsRet = HttpRequestUtil.getExecMQL(dataRagConfig, "select fields from /system/class where name='" + className + "'");
					if (fieldsRet.size() > 0) {
						JSONArray fields = fieldsRet.getJSONObject(0).getJSONArray("fields");
						boolean attrExist = false;
						for (int i = 0; i < fields.size(); i++) {
							if (attrName.equals(fields.getString(i))) {
								attrExist = true;
								break;
							}
						}
						if (!attrExist) {
							String mql = "alter class " + className + " add column " + attrName + " ";
							if ("varchar".equals(type) || "text".equals(type) || "int".equals(type) || "long".equals(type) || "double".equals(type) || "date".equals(type) || "timestamp".equals(type)) {
								mql += type + " ;";
							} else if ("bucket".equals(type)) {
								mql += "bucket {\n"
										+ "        \"collect\": 10,\n"
										+ "        \"dict\": true,\n"
										+ "        \"slot\": 5,\n"
										+ "        \"ttl\": 0,\n"
										+ "        \"type\": \"promdb\",\n"
										+ "        \"version\": 1\n"
										+ "	} ;";
							} else if ("vector".equals(type)) {
								mql += "list<varchar> ;";
							} else {
								throw new Exception(langService.get(lang, "Admin.attr.typeError"));
							}
							HttpRequestUtil.getExecMQL(dataRagConfig, mql);
						}
					}
				}
				
				Map<String, Object> attrDef = new HashMap<String, Object>();
				attrDef.put("name", attrName.trim());
				attrDef.put("showName", showName);
				attrDef.put("attrDesc", attrDesc);
				attrDef.put("type", type);
				attrDef.put("bizzkey", bizzKey);
				attrDef.put("enable", enable);
				attrDef.put("permissionField", false);
				if ("bucket".equals(type)) {
					attrDef.put("indicators", new ArrayList<Map<String, String>>());
				}
				attrs.add(attrDef);
				writeJSONRule(jsonRule, user.getDomainId());
				
				AuditLog auditLog = new AuditLog();
				auditLog.setId(UUID.randomUUID().toString());
		        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		        auditLog.setByAi(false);
		        auditLog.setUserId(user.getId());
		        auditLog.setUserName(user.getUserName());
		        auditLog.setOperation(AuditLog.OPERATION_UPD);
		        String sysLang = businessConfig.getLang();
		        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.add") + ": " + attrName);
		        auditLog.setParamter(JSONObject.toJSONString(attrDef));
		        auditLog.setOperateTime(System.currentTimeMillis());
		        auditLogDao.save(auditLog, user.getDomainId());
			} else {
				throw new Exception(langService.get(lang, "Admin.attr.exist"));
			}
		} else {
			throw new Exception(langService.get(lang, "Admin.class.notFound"));
		}
	}
	
	@Override
	public void delClassAttr(String className, String attrName, String lang, User user) throws Exception {
		attrName = attrName.trim();
		className = className.trim();
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className)) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			int removeIndex = -1;
			for (int i = 0; i < attrs.size(); i++) {
				Map<String, Object> attrDef = attrs.get(i);
				if (attrDef.get("name").equals(attrName)) {
					removeIndex = i;
					break;
				}
			}
			if (removeIndex >= 0) {
				if (Boolean.TRUE.equals(attrs.get(removeIndex).get("primaryKey"))) {
					throw new Exception(langService.get(lang, "Admin.attr.primaryKeyLocked"));
				}
				attrs.remove(removeIndex);
				validatePrimaryKey(jsonRule);
				BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
				if (adapter.useM3()) {
					JSONArray fieldsRet = HttpRequestUtil.getExecMQL(dataRagConfig, "select fields from /system/class where name='" + className + "'");
					if (fieldsRet.size() > 0) {
						JSONArray fields = fieldsRet.getJSONObject(0).getJSONArray("fields");
						boolean attrExist = false;
						for (int i = 0; i < fields.size(); i++) {
							if (attrName.equals(fields.getString(i))) {
								attrExist = true;
								break;
							}
						}
						if (attrExist) {
							JSONArray objCountRet = HttpRequestUtil.getExecMQL(dataRagConfig, "select count(id) as c from " + className + "");
							Integer objCount = objCountRet.getJSONObject(0).getInteger("c");
							if (objCount == 0) {
								String mql = "alter class " + className + " drop column " + attrName + " ;";
								HttpRequestUtil.getExecMQL(dataRagConfig, mql);
							}
						}
					}
				}
				
				writeJSONRule(jsonRule, user.getDomainId());
				
				AuditLog auditLog = new AuditLog();
				auditLog.setId(UUID.randomUUID().toString());
		        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		        auditLog.setByAi(false);
		        auditLog.setUserId(user.getId());
		        auditLog.setUserName(user.getUserName());
		        auditLog.setOperation(AuditLog.OPERATION_UPD);
		        String sysLang = businessConfig.getLang();
		        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.del") + ": " + attrName);
		        auditLog.setParamter(className + "    " + attrName);
		        auditLog.setOperateTime(System.currentTimeMillis());
		        auditLogDao.save(auditLog, user.getDomainId());
			}
		}
	}

	@Override
	public void setClassAttrDesc(String className, String attr, String desc, String enable, String lang, User user) throws Exception {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr)) {
						if (!Boolean.valueOf(enable) && Boolean.TRUE.equals(attrDef.get("primaryKey"))) {
							throw new Exception(langService.get(lang, "Admin.attr.primaryKeyLocked"));
						}
						attrDef.put("attrDesc", desc);
						attrDef.put("enable", Boolean.valueOf(enable));
						writeJSONRule(jsonRule, user.getDomainId());
						
						AuditLog auditLog = new AuditLog();
						auditLog.setId(UUID.randomUUID().toString());
				        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
				        auditLog.setByAi(false);
				        auditLog.setUserId(user.getId());
				        auditLog.setUserName(user.getUserName());
				        auditLog.setOperation(AuditLog.OPERATION_UPD);
				        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				        String sysLang = businessConfig.getLang();
				        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.upd") + ": " + attr);
				        auditLog.setParamter(JSONObject.toJSONString(attrDef));
				        auditLog.setOperateTime(System.currentTimeMillis());
				        auditLogDao.save(auditLog, user.getDomainId());
						break;
					}
				}
				break;
			}
		}
	}
	
	@Override
	public void setClassAttrShowName(String className, String attr, String showName, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr)) {
						attrDef.put("showName", showName);
						writeJSONRule(jsonRule, user.getDomainId());
						
						AuditLog auditLog = new AuditLog();
						auditLog.setId(UUID.randomUUID().toString());
				        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
				        auditLog.setByAi(false);
				        auditLog.setUserId(user.getId());
				        auditLog.setUserName(user.getUserName());
				        auditLog.setOperation(AuditLog.OPERATION_UPD);
				        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				        String sysLang = businessConfig.getLang();
				        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.upd") + ": " + attr);
				        auditLog.setParamter(JSONObject.toJSONString(attrDef));
				        auditLog.setOperateTime(System.currentTimeMillis());
				        auditLogDao.save(auditLog, user.getDomainId());
						break;
					}
				}
				break;
			}
		}
	}
	
	@Override
	public void setClassAttrTimeFormat(String className, String attr, String format, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr)) {
						attrDef.put("format", format);
						writeJSONRule(jsonRule, user.getDomainId());
						
						AuditLog auditLog = new AuditLog();
						auditLog.setId(UUID.randomUUID().toString());
				        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
				        auditLog.setByAi(false);
				        auditLog.setUserId(user.getId());
				        auditLog.setUserName(user.getUserName());
				        auditLog.setOperation(AuditLog.OPERATION_UPD);
				        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				        String sysLang = businessConfig.getLang();
				        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.upd") + ": " + attr);
				        auditLog.setParamter(JSONObject.toJSONString(attrDef));
				        auditLog.setOperateTime(System.currentTimeMillis());
				        auditLogDao.save(auditLog, user.getDomainId());
						break;
					}
				}
				break;
			}
		}
	}
	
	@Override
	public void setClassAttrShouldReturn(String className, String attr, boolean shouldReturn, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr)) {
						attrDef.put("bizzkey", shouldReturn);
						writeJSONRule(jsonRule, user.getDomainId());
						
						AuditLog auditLog = new AuditLog();
						auditLog.setId(UUID.randomUUID().toString());
				        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
				        auditLog.setByAi(false);
				        auditLog.setUserId(user.getId());
				        auditLog.setUserName(user.getUserName());
				        auditLog.setOperation(AuditLog.OPERATION_UPD);
				        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
				        String sysLang = businessConfig.getLang();
				        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr.upd") + ": " + attr);
				        auditLog.setParamter(JSONObject.toJSONString(attrDef));
				        auditLog.setOperateTime(System.currentTimeMillis());
				        auditLogDao.save(auditLog, user.getDomainId());
						break;
					}
				}
				break;
			}
		}
	}

	@Override
	public void setClassAttrPermissionField(String className, String attr, boolean permissionField, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (!Objects.equals(classDef.get("className"), className)) continue;
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrs) {
				if (!Objects.equals(attrDef.get("name"), attr)) continue;
				String type = String.valueOf(attrDef.get("type"));
				SystemUtils.assertTrue(!permissionField || "varchar".equals(type) || "text".equals(type),
						"The parameterized permission field must be of string type!");
				attrDef.put("permissionField", permissionField);
				writeJSONRule(jsonRule, user.getDomainId());
				return;
			}
		}
		throw new IllegalArgumentException("Data class field does not exist: " + className + "." + attr);
	}
	
	@Override
	public void setClassAttrPrimaryKey(String className, String attr, String lang, User user) throws Exception {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				Map<String, Object> target = attrs.stream().filter(attrDef -> attrDef.get("name").equals(attr)).findFirst().orElse(null);
				if (target == null || !"varchar".equals(target.get("type")) || Boolean.FALSE.equals(target.get("enable"))) {
					throw new Exception(langService.get(lang, "Admin.attr.primaryKeyInvalid"));
				}
				// M3 objects are keyed by id (key=manu, insert and query by id); the model key must stay id there.
				if (!"id".equals(attr) && dataAdapterRegistry.create(businessConfigService.get(user.getDomainId()), null).useM3()) {
					throw new Exception(langService.get(lang, "Admin.class.m3PrimaryKeyId"));
				}
				for (Map<String, Object> attrDef : attrs) {
					attrDef.put("primaryKey", attrDef == target);
				}
				writeJSONRule(jsonRule, user.getDomainId());
				break;
			}
		}
	}
	
	@Override
	public void addBucketIndicator(String className, String attrName, String indicatorName, String indicatorDesc, String indicatorUnit, String lang, User user) throws Exception {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className.trim())) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			Map<String, Object> attrDef = null;
			for (Map<String, Object> ad : attrs) {
				if (ad.get("name").equals(attrName.trim())) {
					attrDef = ad;
					break;
				}
			}
			if (attrDef != null) {
				List<Map<String, Object>> indicators = (List<Map<String, Object>>)attrDef.get("indicators");
				boolean exist = false;
				for (Map<String, Object> indicator : indicators) {
					if (indicator.get("name").equals(indicatorName.trim())) {
						exist = true;
						break;
					}
				}
				if (!exist) {
					Map<String, Object> indicatorDef = new HashMap<String, Object>();
					indicatorDef.put("name", indicatorName.trim());
					indicatorDef.put("desc", indicatorDesc);
					indicatorDef.put("unit", indicatorUnit);
					indicators.add(indicatorDef);
					writeJSONRule(jsonRule, user.getDomainId());
					
					AuditLog auditLog = new AuditLog();
					auditLog.setId(UUID.randomUUID().toString());
			        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
			        auditLog.setByAi(false);
			        auditLog.setUserId(user.getId());
			        auditLog.setUserName(user.getUserName());
			        auditLog.setOperation(AuditLog.OPERATION_UPD);
			        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			        String sysLang = businessConfig.getLang();
			        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr") + ": " + attrName + ", " + langService.get(sysLang, "AuditLog.indicator.add") + ": " + indicatorName);
			        auditLog.setParamter(JSONObject.toJSONString(indicatorDef));
			        auditLog.setOperateTime(System.currentTimeMillis());
			        auditLogDao.save(auditLog, user.getDomainId());
				} else {
					throw new Exception(langService.get(lang, "Admin.indicator.exist"));
				}
			} else {
				throw new Exception(langService.get(lang, "Admin.attr.notFound"));
			}
		} else {
			throw new Exception(langService.get(lang, "Admin.class.notFound"));
		}
	}
	
	@Override
	public void delBucketIndicator(String className, String attrName, String indicatorName, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className)) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			Map<String, Object> attrDef = null;
			for (Map<String, Object> ad : attrs) {
				if (ad.get("name").equals(attrName)) {
					attrDef = ad;
					break;
				}
			}
			if (attrDef != null) {
				List<Map<String, Object>> indicators = (List<Map<String, Object>>)attrDef.get("indicators");
				int removeIndex = -1;
				for (int i = 0; i < indicators.size(); i++) {
					Map<String, Object> indicator = indicators.get(i);
					if (indicator.get("name").equals(indicatorName)) {
						removeIndex = i;
						break;
					}
				}
				if (removeIndex >= 0) {
					indicators.remove(removeIndex);
					writeJSONRule(jsonRule, user.getDomainId());
					
					AuditLog auditLog = new AuditLog();
					auditLog.setId(UUID.randomUUID().toString());
			        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
			        auditLog.setByAi(false);
			        auditLog.setUserId(user.getId());
			        auditLog.setUserName(user.getUserName());
			        auditLog.setOperation(AuditLog.OPERATION_UPD);
			        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			        String sysLang = businessConfig.getLang();
			        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr") + ": " + attrName + ", " + langService.get(sysLang, "AuditLog.indicator.del") + ": " + indicatorName);
			        auditLog.setParamter(className + "    " + attrName + "    " + indicatorName);
			        auditLog.setOperateTime(System.currentTimeMillis());
			        auditLogDao.save(auditLog, user.getDomainId());
				}
			}
		}
	}
	
	@Override
	public void setBucketIndicatorDesc(String className, String attr, String indicator, String desc, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr) && "bucket".equals(attrDef.get("type"))) {
						if (attrDef.get("indicators") != null) {
							List<Map<String, Object>> indicators = (List<Map<String, Object>>)attrDef.get("indicators");
							for (Map<String, Object> indicatorObj : indicators) {
								if (indicatorObj.get("name").equals(indicator)) {
									indicatorObj.put("desc", desc);
									writeJSONRule(jsonRule, user.getDomainId());
									
									AuditLog auditLog = new AuditLog();
									auditLog.setId(UUID.randomUUID().toString());
							        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
							        auditLog.setByAi(false);
							        auditLog.setUserId(user.getId());
							        auditLog.setUserName(user.getUserName());
							        auditLog.setOperation(AuditLog.OPERATION_UPD);
							        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
							        String sysLang = businessConfig.getLang();
							        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr") + ": " + attr + ", " + langService.get(sysLang, "AuditLog.indicator.upd") + ": " + indicator);
							        auditLog.setParamter(JSONObject.toJSONString(indicatorObj));
							        auditLog.setOperateTime(System.currentTimeMillis());
							        auditLogDao.save(auditLog, user.getDomainId());
									break;
								}
							}
							break;
						}
					}
				}
				break;
			}
		}
	}
	
	@Override
	public void setBucketIndicatorUnit(String className, String attr, String indicator, String unit, User user) {
		Map<String, Object> jsonRule = getJSONRule(user.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(className)) {
				List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrs) {
					if (attrDef.get("name").equals(attr) && "bucket".equals(attrDef.get("type"))) {
						if (attrDef.get("indicators") != null) {
							List<Map<String, Object>> indicators = (List<Map<String, Object>>)attrDef.get("indicators");
							for (Map<String, Object> indicatorObj : indicators) {
								if (indicatorObj.get("name").equals(indicator)) {
									indicatorObj.put("unit", unit);
									writeJSONRule(jsonRule, user.getDomainId());
									
									AuditLog auditLog = new AuditLog();
									auditLog.setId(UUID.randomUUID().toString());
							        auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
							        auditLog.setByAi(false);
							        auditLog.setUserId(user.getId());
							        auditLog.setUserName(user.getUserName());
							        auditLog.setOperation(AuditLog.OPERATION_UPD);
							        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
							        String sysLang = businessConfig.getLang();
							        auditLog.setDescription(langService.get(sysLang, "AuditLog.class") + ": " + className + ", " + langService.get(sysLang, "AuditLog.attr") + ": " + attr + ", " + langService.get(sysLang, "AuditLog.indicator.upd") + ": " + indicator);
							        auditLog.setParamter(JSONObject.toJSONString(indicatorObj));
							        auditLog.setOperateTime(System.currentTimeMillis());
							        auditLogDao.save(auditLog, user.getDomainId());
									break;
								}
							}
							break;
						}
					}
				}
				break;
			}
		}
	}

	@Override
	public Map<String, Object> getJSONRule(String domainId) {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		if (jsonRule == null) {
			try {
				jsonRule = JSON.parseObject(FileUtil.getResourceFileLoadAll("JSONRule.json", "utf-8"));
			} catch (Exception e) {
				jsonRule = new JSONObject();
				jsonRule.put("datasetdesc", "");
				jsonRule.put("classlist", new JSONArray());
				jsonRule.put("classDef", new JSONArray());
				jsonRule.put("relationship_rule", new JSONObject());
			}
			writeJSONRule(jsonRule, domainId);
		}
		return jsonRule;
	}

	@Override
	public Map<String, String> getSchemaMarkdown(List<String> classNames, String domainId){
		Map<String, String> dbSchemaMarkdown = DBSchemaUtil.getDBSchema(getJSONRule(domainId), classNames, false);
		return dbSchemaMarkdown;
	}
	
	@Override
	public Map<String, String> getSchemaMarkdownV2(List<String> classNames, String domainId){
		Map<String, String> mapDBSchema =  new HashMap<String, String>();
		Map<String, Object> jsonRule = getJSONRule(domainId);
		String datasetDesc = (String)jsonRule.get("datasetdesc");
        mapDBSchema.put(DBSchemaUtil.KEY_DATASET_DESC, datasetDesc);
        String classNamesStr = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
        mapDBSchema.put(DBSchemaUtil.KEY_CLASS_DEF, classNamesStr);
		return mapDBSchema;
	}
	
	@Override
	public String getSchemaByClassName(List<String> classNames, String domainId) {
		try {
			Map<String, Object> jsonRule = getJSONRule(domainId);
			String md = "";
			for (String className : classNames) {
				md += DBSchemaUtil.generateMarkDownByClassName(className, jsonRule) + "\n";
			}
			return md;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get object class attribute definitions";
		}
	}
	
	@Override
	public String getRelationshipByClassNames(List<String> classNames, String domainId) {
		try {
			Map<String, Object> jsonRule = getJSONRule(domainId);
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			Set<String> classNameSet = new HashSet<String>();
			for (String className : classNames) {
				classNameSet.add(className.trim());
			}
			StringBuffer sbMarkDownRelationship = new StringBuffer();
	        sbMarkDownRelationship.append("| Source class | Relationship type | Target class | Relationship description |\n");
	        sbMarkDownRelationship.append("| ---------- | ---------- | ---------- | -------------------- |\n");
			for (String key : relationship_rule.keySet()) {
				Map<String, String> rel = (Map<String, String>)relationship_rule.get(key);
				if (classNameSet.contains(rel.get("fromclass")) || classNameSet.contains(rel.get("toclass"))) {
					sbMarkDownRelationship.append("| ").append(rel.get("fromclass"))
						.append(" | ").append(key)
	                    .append(" | ").append(rel.get("toclass"))
	                    .append(" | ").append(rel.get("desc"))
	                    .append(" |\n");
				}
			}
			return sbMarkDownRelationship.toString();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get relationship definitions";
		}
	}
	
	@Override
	public String queryDistinctAttrValue(String className, String attrName, String query, int limit, UserDataPermission permission, String domainId) {
		String md = "";
		int showRowDefault = 100;
		
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className)) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			Map<String, Object> attrDef = null;
			for (Map<String, Object> ad : attrDefs) {
				if (ad.get("name").equals(attrName)) {
					attrDef = ad;
					break;
				}
			}
			if (attrDef != null) {
				if ("varchar".equals(attrDef.get("type")) || "text".equals(attrDef.get("type"))) {
					JSONArray dsls = new JSONArray();
			        JSONObject dsl = new JSONObject();
			        dsl.put("problem", "");
			        JSONObject answer = new JSONObject();
			        JSONArray steps = new JSONArray();
			        JSONObject step0 = new JSONObject();
			        JSONObject graph0 = new JSONObject();
			        JSONArray patterns0 = new JSONArray();
			        JSONObject pattern0 = new JSONObject();
			        JSONArray objects0 = new JSONArray();
			        JSONObject object0 = new JSONObject();
			        object0.put("idx", 0);
			        object0.put("variable", "variable");
			        object0.put("class", className);
			        if (query != null && !"".equals(query.trim())) {
			        	query = query.trim();
			        	if (!query.startsWith("%") && !query.endsWith("%")) {
			        		query = "%" + query + "%";
			        	}
			        	JSONObject conditions = new JSONObject();
			        	JSONObject properties = new JSONObject();
			        	properties.put("field", attrName);
			        	properties.put("operator", "like");
			        	properties.put("value", query);
			        	conditions.put("properties", properties);
			        	object0.put("conditions", conditions);
			        }
			        objects0.add(object0);
			        pattern0.put("objects", objects0);
			        patterns0.add(pattern0);
			        graph0.put("patterns", patterns0);
			        graph0.put("pattern_logic", "and");
			        step0.put("graph", graph0);
			        JSONObject output0 = new JSONObject();
			        output0.put("to_user", true);
			        JSONArray fields0 = new JSONArray();
			        JSONObject field0 = new JSONObject();
					field0.put("variable", "variable");
					field0.put("field", attrName);
					field0.put("distinct", true);
					field0.put("as", attrName);
					fields0.add(field0);
			        output0.put("fields", fields0);
			        step0.put("output", output0);
			        steps.add(step0);
			        answer.put("steps", steps);
			        dsl.put("answer", answer);
			        dsls.add(dsl);
			        
			        List<String> values = new ArrayList<String>();
			        BusinessConfig businessConfig = businessConfigService.get(domainId);
			        DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), null, false, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
			        Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
			        if (rowPermissionDataMap.get("data") != null 
			        		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
			        		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
			        		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
			        	List<Map<String, Object>> rows = (List<Map<String, Object>>)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer");
			        	for (Map<String, Object> row : rows) {
			        		if (row.get(attrName) != null) {
			        			values.add(((String)row.get(attrName)).trim());
			        		}
			        	}
			        }
			        md = "There are " + values.size() + " deduplicated records matching the conditions\n";
			        int showRowSize = 0;
			        if (limit <= 0) {
			        	if (values.size() > showRowDefault) {
			        		md += "Only " + showRowDefault + " rows are shown here\n";
				        	showRowSize = showRowDefault;
			        	} else {
				        	showRowSize = values.size();
			        	}
			        } else if (limit > 0) {
			        	if (limit < values.size()) {
			        		md += "Only " + limit + " rows are shown here\n";
				        	showRowSize = limit;
			        	} else {
			        		showRowSize = values.size();
			        	}
			        }
			        md += "| Value |\n| --- |\n";
			        for (int i = 0; i < showRowSize; i++) {
			        	md += "| " + values.get(i) + " |\n";
			        }
				} else {
					md = "Object class `" + className + "`'s attribute `" + attrName + "` is not of varchar or text type";
				}
			} else {
				md = "Object class `" + className + "` does not contain attribute `" + attrName + "`";
			}
		} else {
			md = "Object class `" + className + "` does not exist";
		}
		
		return md;
	}

	@Override
	public String getBussinessKnowledgeMarkdown(String domainId){
		StringBuffer sbMarkdown = new StringBuffer();
		String bussinessKnowledge = knowledgeService.getBussinessKnowledgeMarkdown(domainId);
		String bussinessExample = bussinessExampleService.getBussinessExampleMarkdown(domainId);
		String businessExampleQuestionSpliter = bussinessExampleService.getBusinessExampleQuestionSpliterMarkdown(domainId);

		sbMarkdown.append(bussinessKnowledge).append("\n");
		sbMarkdown.append(bussinessExample).append("\n");
		sbMarkdown.append(businessExampleQuestionSpliter).append("\n");
		return sbMarkdown.toString();
	}
	
	private void writeJSONRule(Map<String, Object> jsonRule, String domainId) {
		validatePrimaryKey(jsonRule);
		jsonRuleDao.save(jsonRule, domainId);
	}

	/**
	 * Enforce the primary-key invariant that lets vector/row-permission DSL rewriting use a single
	 * primary-key field name across M3 and relational adapters:
	 * every class has exactly one enabled {@code primaryKey=true} attribute, and its type is {@code varchar}.
	 * Operations with external DDL also call this on the changed rule before the DDL.
	 */
	private void validatePrimaryKey(Map<String, Object> jsonRule) {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			String className = (String)classDef.get("className");
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			int pkCount = 0;
			String pkName = null;
			String pkType = null;
			for (Map<String, Object> attr : attrs) {
				if (attr.get("enable") == null || (Boolean)attr.get("enable")) {
					if (attr.get("primaryKey") != null && (Boolean)attr.get("primaryKey")) {
						pkCount++;
						pkName = (String)attr.get("name");
						pkType = (String)attr.get("type");
					}
				}
			}
			if (pkCount != 1) {
				throw new IllegalArgumentException("Class [" + className + "] must have exactly one primaryKey attribute, but found " + pkCount);
			}
			if (!"varchar".equals(pkType)) {
				throw new IllegalArgumentException("Primary key [" + pkName + "] of class [" + className + "] must be of type varchar, but was " + pkType);
			}
		}
	}
	
	@Override
	public JSONObject getPrettyJSONRule(String domainId) {
		Map<String, Object> jsonRule = getJSONRule(domainId);
		JSONObject json = new JSONObject();
		json.put("datasetDesc", jsonRule.get("datasetdesc"));
		json.put("classList", jsonRule.get("classlist"));
		JSONArray classDefs = new JSONArray();
		if (jsonRule.get("classDef") != null) {
			for (Map<String, Object> classDef : (List<Map<String, Object>>)jsonRule.get("classDef")) {
				JSONObject classDefJson = new JSONObject();
				classDefJson.put("name", classDef.get("className"));
				classDefJson.put("showName", classDef.get("showName"));
				classDefJson.put("desc", classDef.get("classDesc"));
				classDefJson.put("classToCard", classDef.get("classToCard"));
				classDefJson.put("instanceToCard", classDef.get("instanceToCard"));
				classDefJson.put("inStarChart", classDef.get("inStarChart"));
				JSONArray attrDefs = new JSONArray();
				if (classDef.get("attrs") != null) {
					for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
						JSONObject attrDefJson = new JSONObject();
						attrDefJson.put("name", attrDef.get("name"));
						attrDefJson.put("showName", attrDef.get("showName"));
						attrDefJson.put("desc", attrDef.get("attrDesc"));
						attrDefJson.put("type", attrDef.get("type"));
						attrDefJson.put("bizzKey", attrDef.get("bizzkey"));
						attrDefJson.put("enable", attrDef.get("enable"));
						attrDefJson.put("permissionField", Boolean.TRUE.equals(attrDef.get("permissionField")));
						attrDefJson.put("primaryKey", attrDef.get("primaryKey"));
						if (attrDef.get("indicators") != null) {
							JSONArray indicatorDefs = new JSONArray();
							for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
								JSONObject indicatorDefJson = new JSONObject();
								indicatorDefJson.put("name", indicatorDef.get("name"));
								indicatorDefJson.put("desc", indicatorDef.get("desc"));
								indicatorDefJson.put("unit", indicatorDef.get("unit"));
								indicatorDefs.add(indicatorDefJson);
							}
							attrDefJson.put("indicators", indicatorDefs);
						}
						attrDefs.add(attrDefJson);
					}
				}
				classDefJson.put("attrs", attrDefs);
				classDefs.add(classDefJson);
			}
		}
		json.put("classDefs", classDefs);
		JSONObject relationshipDefs = new JSONObject();
		if (jsonRule.get("relationship_rule") != null) {
			for (String key : ((Map<String, Object>)jsonRule.get("relationship_rule")).keySet()) {
				Map<String, Object> relationshipDef = (Map<String, Object>)((Map<String, Object>)jsonRule.get("relationship_rule")).get(key);
				JSONObject relationshipDefJson = new JSONObject();
				relationshipDefJson.put("fromClass", relationshipDef.get("fromclass"));
				relationshipDefJson.put("toClass", relationshipDef.get("toclass"));
				relationshipDefJson.put("desc", relationshipDef.get("desc"));
				relationshipDefJson.put("fromField", relationshipDef.get("fromField"));
				relationshipDefJson.put("toField", relationshipDef.get("toField"));
				relationshipDefs.put(key, relationshipDefJson);
			}
		}
		json.put("relationshipDefs", relationshipDefs);
		return json;
	}
	
	@Override
	public void setPrettyJSONRule(JSONObject prettyJsonRule, String domainId) {
		Map<String, Object> prettyRule = JSON.parseObject(prettyJsonRule.toString());
		Map<String, Object> rule = new HashMap<String, Object>();
		rule.put("datasetdesc", prettyRule.get("datasetDesc"));
		rule.put("classlist", prettyRule.get("classList"));
		List<Map<String, Object>> classDefs = new ArrayList<Map<String, Object>>();
		if (prettyRule.get("classDefs") != null) {
			for (Map<String, Object> cd : (List<Map<String, Object>>)prettyRule.get("classDefs")) {
				Map<String, Object> classDef = new HashMap<String, Object>();
				classDef.put("className", cd.get("name"));
				classDef.put("showName", cd.get("showName"));
				classDef.put("classDesc", cd.get("desc"));
				classDef.put("classToCard", cd.get("classToCard"));
				classDef.put("instanceToCard", cd.get("instanceToCard"));
				classDef.put("inStarChart", cd.get("inStarChart"));
				List<Map<String, Object>> attrDefs = new ArrayList<Map<String, Object>>();
				if (cd.get("attrs") != null) {
					for (Map<String, Object> ad : (List<Map<String, Object>>)cd.get("attrs")) {
						Map<String, Object> attrDef = new HashMap<String, Object>();
						attrDef.put("name", ad.get("name"));
						attrDef.put("showName", ad.get("showName"));
						attrDef.put("attrDesc", ad.get("desc"));
						attrDef.put("type", ad.get("type"));
						attrDef.put("bizzkey", ad.get("bizzKey"));
						attrDef.put("enable", ad.get("enable"));
						attrDef.put("permissionField", Boolean.TRUE.equals(ad.get("permissionField")));
						attrDef.put("primaryKey", ad.get("primaryKey"));
						if (ad.get("indicators") != null) {
							List<Map<String, Object>> indicatorDefs = new ArrayList<Map<String, Object>>();
							for (Map<String, Object> id : (List<Map<String, Object>>)ad.get("indicators")) {
								Map<String, Object> indicatorDef = new HashMap<String, Object>();
								indicatorDef.put("name", id.get("name"));
								indicatorDef.put("desc", id.get("desc"));
								indicatorDef.put("unit", id.get("unit"));
								indicatorDefs.add(indicatorDef);
							}
							attrDef.put("indicators", indicatorDefs);
						}
						attrDefs.add(attrDef);
					}
				}
				classDef.put("attrs", attrDefs);
				classDefs.add(classDef);
			}
		}
		rule.put("classDef", classDefs);
		Map<String, Map<String, String>> relationshipDefs = new HashMap<String, Map<String, String>>();
		if (prettyRule.get("relationshipDefs") != null) {
			for (String key : ((Map<String, Map<String, String>>)prettyRule.get("relationshipDefs")).keySet()) {
				Map<String, String> rd = ((Map<String, Map<String, String>>)prettyRule.get("relationshipDefs")).get(key);
				Map<String, String> relationshipDef = new HashMap<String, String>();
				relationshipDef.put("fromclass", rd.get("fromClass"));
				relationshipDef.put("toclass", rd.get("toClass"));
				relationshipDef.put("desc", rd.get("desc"));
				relationshipDef.put("fromField", rd.get("fromField"));
				relationshipDef.put("toField", rd.get("toField"));
				relationshipDef.put("fromdesc", "");
				relationshipDef.put("todesc", "");
				relationshipDefs.put(key, relationshipDef);
			}
		}
		rule.put("relationship_rule", relationshipDefs);
		writeJSONRule(rule, domainId);
	}
	
	@Override
	public boolean saveQuestionSpliterExample(String content, boolean inheritDefault, String domainId) {
		return saveExample(QueryExampleConfigDao.QUESTION_SPLITER, content, inheritDefault, domainId);
	}
	
	@Override
	public String getQuestionSpliterExample(String domainId) {
		return getExample(QueryExampleConfigDao.QUESTION_SPLITER, "question_spliter_example.md", domainId);
	}
	
	@Override
	public boolean saveDslCookerExample(String content, boolean inheritDefault, String domainId) {
		return saveExample(QueryExampleConfigDao.DSL_COOKER, content, inheritDefault, domainId);
	}
	
	@Override
	public String getDslCookerExample(String domainId) {
		return getExample(QueryExampleConfigDao.DSL_COOKER, "dsl_cooker_example.md", domainId);
	}

	@Override
	public boolean saveAbcProgrammerExample(String content, boolean inheritDefault, String domainId) {
		return saveExample(QueryExampleConfigDao.ABC_PROGRAMMER, content, inheritDefault, domainId);
	}

	@Override
	public String getAbcProgrammerExample(String domainId) {
		return getExample(QueryExampleConfigDao.ABC_PROGRAMMER, "abc_programmer_example.md", domainId);
	}

	private boolean saveExample(String field, String content, boolean inheritDefault, String domainId) {
		try {
			queryExampleConfigDao.save(domainId, field, content, inheritDefault);
			return true;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return false;
		}
	}

	private String getExample(String field, String defaultFile, String domainId) {
		JSONObject config = queryExampleConfigDao.query(domainId);
		if (config.containsKey(field)) {
			return config.getString(field);
		}
		if (AdminServiceImpl.class.getClassLoader().getResource(defaultFile) == null) {
			throw new IllegalStateException("Default query example not found: " + defaultFile);
		}
		return FileUtil.getResourceFileLoadAll(defaultFile, "utf-8");
	}

}
