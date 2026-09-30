package io.ontomato.dataengine.tools;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.SandboxService;
import io.ontomato.dataengine.service.WriteFunctionOperationService;
import io.ontomato.dataengine.util.DslUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("sandboxSkillTools")
public class SandboxSkillTools {
	
	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private SandboxService sandboxService;
	
	@Autowired
	private WriteFunctionOperationService writeFunctionOperationService;

	@Autowired
	private AgentWorkspaceService workspaceService;

	@Tool("Prepare the test data to be imported into the sandbox\n"
			+ "Input: object data, relationship data, vector data\n"
			+ "Output: execution result or failure reason")
    public String prepareTestData(@P("object data") List<Map> objDatas, @P("relationship data") List<Map> relDatas, @P("vector data") List<Map> vectorDatas) {
		FileOutputStream fos = null;
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String domainId = callContext.getDomainId();
			String sandboxId = callContext.getSessionId();
			
			// Check the object data
			Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
			for (Map<String, Object> classDef : classDefs) {
				classDefMap.put((String)classDef.get("className"), classDef);
			}
			Map<String, Set<String>> classIdsMap = new HashMap<String, Set<String>>();
			for (Map<String, Object> objData : objDatas) {
				String className = (String)objData.get("className");
				Map<String, Object> classDef = classDefMap.get(className);
				if (classDef != null) {
					Set<String> attrNameSet = new HashSet<String>();
					String pk = DslUtil.getPrimaryKey(classDef);
					List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
					for (Map<String, Object> attrDef : attrDefs) {
						if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
							attrNameSet.add((String)attrDef.get("name"));
						}
					}
					Set<String> ids = new HashSet<String>();
					List<Map<String, Object>> rows = (List<Map<String, Object>>)objData.get("rows");
					for (Map<String, Object> row : rows) {
						for (String key : row.keySet()) {
							if (!attrNameSet.contains(key)) {
								throw new Exception("The row of Class[" + className + "] has a property[" + key + "], but that property does not belong to Class[" + className + "].");
							}
						}
						if (row.get(pk) != null && !"".equals(((String)row.get(pk)).trim())) {
							String id = ((String)row.get(pk));
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
			
			// Check the relationship data
			List<Map<String, Object>> newRelDatas = new ArrayList<Map<String, Object>>();
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			for (Map<String, Object> relData : relDatas) {
				String relationName = (String)relData.get("relationName");
				String sourceObjId = (String)relData.get("sourceObjId");
				String targetObjId = (String)relData.get("targetObjId");
				
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
					Map<String, Object> newRelData = new HashMap<String, Object>();
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
			
			// Check the vector data
			List<Map<String, Object>> newVectorDatas = new ArrayList<Map<String, Object>>();
			if (vectorDatas != null) {
				for (Map<String, Object> vectorData : vectorDatas) {
					String className = (String) vectorData.get("className");
					String objectId = (String) vectorData.get("objectId");
					String attrName = (String) vectorData.get("attrName");
					String text = (String) vectorData.get("text");
					String fileId = (String) vectorData.get("fileId");
					Map<String, Object> classDef = classDefMap.get(className);
					if (classDef == null) {
						throw new Exception("The vector data: Class[" + className + "] is not exist.");
					}
					Set<String> ids = classIdsMap.get(className);
					if (ids == null || !ids.contains(objectId)) {
						throw new Exception("The vector data: objectId[" + objectId + "] is not in Class[" + className + "].");
					}
					if (attrName == null || "".equals(attrName.trim())) {
						throw new Exception("The vector data: attrName is empty.");
					}
					boolean isVectorAttr = false;
					List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
					for (Map<String, Object> attrDef : attrDefs) {
						if (attrName.equals(attrDef.get("name")) && "vector".equals(attrDef.get("type"))) {
							isVectorAttr = true;
							break;
						}
					}
					if (!isVectorAttr) {
						throw new Exception("The vector data: attrName[" + attrName + "] is not a vector attribute of Class[" + className + "].");
					}
					if (text == null || "".equals(text.trim())) {
						throw new Exception("The vector data: text is empty.");
					}
					Map<String, Object> newVectorData = new HashMap<String, Object>();
					newVectorData.put("className", className);
					newVectorData.put("objectId", objectId);
					newVectorData.put("attrName", attrName);
					newVectorData.put("text", text);
					newVectorData.put("fileId", fileId);
					newVectorDatas.add(newVectorData);
				}
			}
			
			// Save the test data to a JSON file
			File file = getTestDataFile(sandboxId);
			file.getParentFile().mkdirs();
			JSONObject data = new JSONObject();
			data.put("objDatas", objDatas);
			data.put("relDatas", newRelDatas);
			data.put("vectorDatas", newVectorDatas);
			fos = new FileOutputStream(file);
			fos.write(JSON.toJSONString(data, Feature.WriteMapNullValue).getBytes("utf-8"));
			return "Test data preparation completed";
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Execution failed: " + e.getMessage();
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
	private File getTestDataFile(String sandboxId) {
		File file = new File("./python/" + sandboxId + "-testData.json");
		return file;
	}
	
	private String getSuffixFromFileId(String fileId) {
		if (fileId == null || "".equals(fileId.trim())) {
			return "txt";
		}
		int idx = fileId.lastIndexOf(".");
		if (idx >= 0 && idx < fileId.length() - 1) {
			return fileId.substring(idx + 1);
		}
		return "txt";
	}
	
	@Tool("After clearing the sandbox data, import the test data into the sandbox\n"
			+ "Output: execution result or failure reason")
    public String importTestData() {
		FileInputStream fis = null;
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String domainId = callContext.getDomainId();
			String sandboxId = callContext.getSessionId();
			
			File file = getTestDataFile(sandboxId);
			if (file.exists()) {
				Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
				List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
				Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
				for (Map<String, Object> classDef : classDefs) {
					classDefMap.put((String)classDef.get("className"), classDef);
				}
				
				sandboxService.truncateNamespace(sandboxId, domainId);
				
				fis = new FileInputStream(file);
				JSONObject data = JSONObject.parseObject(new String(fis.readAllBytes(), "utf-8"));
				JSONArray objDatas = data.getJSONArray("objDatas");
				for (int i = 0; i < objDatas.size(); i++) {
					JSONObject objData = objDatas.getJSONObject(i);
					String className = objData.getString("className");
					JSONArray rows = objData.getJSONArray("rows");
					Map<String, Object> classDef = classDefMap.get(className);
					sandboxService.insertObjects(sandboxId, classDef, rows, domainId);
				}
				
				JSONArray relDatas = data.getJSONArray("relDatas");
				sandboxService.insertRelations(sandboxId, relDatas, domainId);
				
				JSONArray vectorDatas = data.getJSONArray("vectorDatas");
				if (vectorDatas != null) {
					for (int i = 0; i < vectorDatas.size(); i++) {
						JSONObject vectorData = vectorDatas.getJSONObject(i);
						String className = vectorData.getString("className");
						String objectId = vectorData.getString("objectId");
						String attrName = vectorData.getString("attrName");
						String text = vectorData.getString("text");
						String fileId = vectorData.getString("fileId");
						String suffix = getSuffixFromFileId(fileId);
						writeFunctionOperationService.appendVector(className, attrName, objectId, text, new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), suffix, sandboxId, domainId);
					}
				}
			} else {
				throw new Exception("The test data file to be imported into the sandbox does not exist");
			}
			return "Test data import into the sandbox completed";
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Execution failed: " + e.getMessage();
		} finally {
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}
	
	@Tool("Execute DSL in the sandbox to get the query result or the query error\n" +
            "Input: the relative path of the DSL JSON file in this workspace; the file content must be a single JSON object, the full DSL text is not accepted\n" +
            "Output: query result or query error text")
	public String query(@P("the relative path of the DSL JSON file in this workspace") String path) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String domainId = callContext.getDomainId();
			String sandboxId = callContext.getSessionId();

			Path file = workspaceService.resolve(sandboxId, path);
			if (!file.toString().endsWith(".json") || !Files.isRegularFile(file)) {
				throw new IllegalArgumentException("The execution entry point must be an existing JSON file in the workspace");
			}
			JSONObject dsl = JSONObject.parseObject(Files.readString(file));
			if (dsl == null) throw new IllegalArgumentException("The DSL file root must be a single JSON object");
			Map<String, Object> result = writeFunctionOperationService.query(dsl, sandboxId, domainId);
			return JSON.toJSONString(result, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Execution failed: " + e.getMessage();
		}
	}
	
}
