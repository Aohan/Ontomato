package io.ontomato.dataengine.tools;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("dataDetectorSkillTools")
public class DataDetectorSkillTools {
	
	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
    private BusinessConfigService businessConfigService;
	
	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Tool("After performing a like filter on an attribute of an object class, the query result of the deduplicated values of that attribute\n" +
            "Input:  object class name, attribute name, content to like, number of records to return\n" +
            "Output:  deduplicated values of that attribute that match the conditions")
	public String queryDistinctAttrValue(
			@P("object class name") String className, 
			@P("attribute name") String attrName, 
			@P("content to like (an empty string means no filtering; the logic of adding % before and after follows sql syntax)") String query, 
			@P("number of records to return (-1 means return all, but when more than 100 records only 100 are shown; if necessary the specified number of records can be forcibly returned)") int limit) {
		AgentCallContext callContext = AgentCallContext.current();
		String md = "";
		int showRowDefault = 100;
		
		Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		className = DBSchemaUtil.normalizeClassName(className, classDefs);
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
			        BusinessConfig businessConfig = businessConfigService.get(callContext.getDomainId());
			        DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), null, false, jsonRule, vectorResourceDao, new UserDataPermission(), HttpRequestUtil.M3Mode.V1, callContext.getDomainId());
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
			        md = "There are " + values.size() + " deduplicated matching records\n";
			        int showRowSize = 0;
			        if (limit <= 0) {
			        	if (values.size() > showRowDefault) {
			        		md += "Only " + showRowDefault + " records are shown here\n";
				        	showRowSize = showRowDefault;
			        	} else {
				        	showRowSize = values.size();
			        	}
			        } else if (limit > 0) {
			        	if (limit < values.size()) {
			        		md += "Only " + limit + " records are shown here\n";
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
	
}
