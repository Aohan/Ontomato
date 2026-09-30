package io.ontomato.dataengine.tools;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.util.DBSchemaUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("schemaSkillTools")
public class SchemaSkillTools {

	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Tool("Get the attribute definitions of these object classes by several object class names\n" +
            "Input:  object class name array\n" +
            "Output:  attribute definitions of these object classes")
    public String getSchemaByClassName(@P("object class name array") List<String> classNames) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			String md = "";
			for (String className : classNames) {
				String normalizedClassName = DBSchemaUtil.normalizeClassName(className.trim(), classDefs);
				md += DBSchemaUtil.generateMarkDownByClassName(normalizedClassName, jsonRule) + "\n";
			}
			return md;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get object class attribute definitions";
		}
	}
	
	@Tool("Get the definitions of their direct one-level relationships by several object classes\n" +
            "Input:  object class name array\n" +
            "Output:  direct one-level relationship definitions")
	public String getRelationshipByClassNames(@P("object class name array") List<String> classNames) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			Set<String> classNameSet = new HashSet<String>();
			for (String className : classNames) {
				classNameSet.add(DBSchemaUtil.normalizeClassName(className.trim(), classDefs));
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
	
}
