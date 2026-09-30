package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import lombok.extern.slf4j.Slf4j;

import java.util.*;

@Slf4j
public class DBSchemaUtil {

    public static final String KEY_DATASET_DESC = "KEY_DATASET_DESC";
    public static final String KEY_CLASS_DEF = "KEY_CLASS_DEF";
    public static final String KEY_RELATIONSHIP_DEF = "KEY_RELATIONSHIP_DEF";
    public static final String KEY_RELATIONSHIP_CHAIN = "KEY_RELATIONSHIP_CHAIN";

    public static String normalizeClassName(String className, List<Map<String, Object>> classDefs) {
        if (className == null) {
            return null;
        }
        for (Map<String, Object> classDef : classDefs) {
            String formalName = (String)classDef.get("className");
            if (className.equals(formalName)) {
                return formalName;
            }
        }
        for (Map<String, Object> classDef : classDefs) {
            String formalName = (String)classDef.get("className");
            if (!formalName.startsWith("/") && className.equals("/" + formalName)) {
                return formalName;
            }
        }
        return className;
    }

    /** Builds parameters from the object list defined by the parameters; the field mapping and baseline are exactly the same as those parsed from the body, and are shared by the test tools and all submission paths. */
    public static List<Parameter> buildParameters(List<Map> defs, List<Map<String, Object>> classDefs) {
        List<Parameter> parameters = new ArrayList<Parameter>();
        for (Map def : defs) {
            Parameter parameter = new Parameter();
            parameter.setName(str(def.get("name")));
            parameter.setType(str(def.get("type")));
            parameter.setDescription(str(def.get("description")));
            parameter.setValue(def.get("value"));
            parameter.setSample(def.get("value"));
            String className = normalizeClassName(str(def.get("className")), classDefs);
            List<String> classNames = new ArrayList<String>();
            if (className != null && !"".equals(className.trim())) {
                classNames.add(className);
            }
            parameter.setClassNames(classNames);
            parameters.add(parameter);
        }
        return parameters;
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }

    /**Get the class definition, relationship definition and relationship chain definition
     * @return
     */
    public static Map<String, String> getDBSchema(Map<String, Object> jsonRule, List<String> classNames, boolean withRelChain) {

        Map<String, String> mapDBSchema =  new HashMap<String, String>();

        String datasetDesc = (String)jsonRule.get("datasetdesc");
        mapDBSchema.put(KEY_DATASET_DESC, datasetDesc);

        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        StringBuffer sbMarkDownClassDefs = new StringBuffer();
        Map<String, String> classNameMap = new HashMap<String, String>();
        for (Map<String, Object> classDef : classDefs) {
        	if (classNames == null || classNames.size() == 0 || classNames.contains(classDef.get("className"))) {
        		sbMarkDownClassDefs.append(generateMarkDownByClassDef(classDef));
                sbMarkDownClassDefs.append("\n");
                classNameMap.put((String)classDef.get("className"), (String)classDef.get("classDesc"));
        	}
        }

        mapDBSchema.put(KEY_CLASS_DEF, sbMarkDownClassDefs.toString());

        //relationship definition
        Map<String, Set<String>> nextRelationshipMap = new HashMap<String, Set<String>>();
        Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
        StringBuffer sbMarkDownRelationship = new StringBuffer();
        sbMarkDownRelationship.append("| source class | target class | relationship type | relationship description |\n");
        sbMarkDownRelationship.append("| ---------- | ---------- | ---------- | -------------------- |\n");
        for (String key : relationship_rule.keySet()) {
            Map<String, String> rel = (Map<String, String>)relationship_rule.get(key);
            if (classNames == null || classNames.size() == 0 || classNames.contains(rel.get("fromclass")) && classNames.contains(rel.get("toclass"))) {
            	sbMarkDownRelationship.append("| ").append(rel.get("fromclass"))
	                .append(" | ").append(rel.get("toclass"))
	                .append(" | ").append(key)
	                .append(" | ").append(rel.get("desc"))
	                .append(" |\n");

				Set<String> nexts0 = nextRelationshipMap.get(rel.get("fromclass"));
				if (nexts0 == null) {
				    nexts0 = new HashSet<String>();
				    nextRelationshipMap.put(rel.get("fromclass"), nexts0);
				}
				nexts0.add(rel.get("toclass"));
				Set<String> nexts1 = nextRelationshipMap.get(rel.get("toclass"));
				if (nexts1 == null) {
				    nexts1 = new HashSet<String>();
				    nextRelationshipMap.put(rel.get("toclass"), nexts1);
				}
				nexts1.add(rel.get("fromclass"));
            }
        }
        sbMarkDownRelationship.append("\n");

        mapDBSchema.put(KEY_RELATIONSHIP_DEF, sbMarkDownRelationship.toString());

        if (withRelChain) {
        	String strRelationLongChain = generateRelationLongChain(classNameMap, nextRelationshipMap);
            mapDBSchema.put(KEY_RELATIONSHIP_CHAIN, strRelationLongChain);
        }

        return mapDBSchema;
    }
    
    public static String generateClassNameMarkDown(Map<String, Object> jsonRule, List<String> classNames) {
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        StringBuffer sbMarkDownClassDefs = new StringBuffer();
        sbMarkDownClassDefs.append("| class name | description |\n| --- | --- |\n");
        for (Map<String, Object> classDef : classDefs) {
        	if (classNames == null || classNames.size() == 0 || classNames.contains(classDef.get("className"))) {
        		sbMarkDownClassDefs.append("| " + classDef.get("className") + " | " + classDef.get("classDesc") + " |\n");
        	}
        }
        return sbMarkDownClassDefs.toString();
    }

    private static String generateMarkDownByClassDef(Map<String, Object> classDef) {
    	StringBuffer sbMarkDownClassDefs = new StringBuffer();
    	sbMarkDownClassDefs.append(" - class name: " + classDef.get("className") + "\n");
        sbMarkDownClassDefs.append("class description: " + classDef.get("classDesc") + "\n");
        sbMarkDownClassDefs.append("| field name | field type | primary key | field description |\n");
        sbMarkDownClassDefs.append("| ---------- | ---------- | ---------- | -------------------- |\n");
        List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
        StringBuffer sbMarkDownIndicatorDefs = new StringBuffer();
        for (Map<String, Object> attr : attrs) {
            Boolean enable = (Boolean)attr.get("enable");
            if(enable == null || enable == true){
                sbMarkDownClassDefs.append("| ").append(attr.get("name"))
                        .append(" | ").append(attr.get("type"))
                        .append(" | ").append(attr.get("primaryKey") != null && (Boolean)attr.get("primaryKey"))
                        .append(" | ").append(attr.get("attrDesc")).append(" |\n");
                if (attr.get("indicators") != null) {
                	List<Map<String, Object>> indicators = (List<Map<String, Object>>)attr.get("indicators");
                	sbMarkDownIndicatorDefs.append("Class \"" + classDef.get("className") + "(" + classDef.get("classDesc") + ")\" time series field " + attr.get("name") + " metric description\n");
                	sbMarkDownIndicatorDefs.append("| metric name | metric description | unit |\n");
                	sbMarkDownIndicatorDefs.append("| ----- | ------- | --- |\n");
                	for (Map<String, Object> indicator : indicators) {
                		sbMarkDownIndicatorDefs.append("| " + indicator.get("name") + " | " + indicator.get("desc") + " | " + indicator.get("unit") + " |\n");
                	}
                }
            }
        }
        return sbMarkDownClassDefs.toString() + "\n" + sbMarkDownIndicatorDefs.toString();
    }

    private static String generateRelationLongChain(Map<String, String> classNameMap, Map<String, Set<String>> nextMap) {
        List<String> chains = new ArrayList<String>();
        Set<String> coverNodes = new HashSet<String>();
        while (classNameMap.size() > coverNodes.size()) {
            String root = null;
            int count = 0;
            for (String node : classNameMap.keySet()) {
                if (!coverNodes.contains(node)) {
                    if (root == null || nextMap.get(node) == null || nextMap.get(node).size() < count) {
                        root = node;
                        count = nextMap.get(node) == null ? 0 : nextMap.get(node).size();
                    }
                }
            }
            List<List<String>> queue = new ArrayList<List<String>>();
            List<String> rootPath = new ArrayList<String>();
            rootPath.add(root);
            queue.add(rootPath);
            while (queue.size() > 0) {
                List<String> path = queue.remove(0);
                String last = path.get(path.size() - 1);
                Set<String> nexts = nextMap.get(last);
                if (nexts != null) {
                    for (String next : nexts) {
                        boolean cycle = false;
                        for (String n : path) {
                            if (next.equals(n)) {
                                cycle = true;
                                break;
                            }
                        }
                        if (cycle) {
                            String relationChain = "";
                            for (String n : path) {
                                relationChain += "[" + classNameMap.get(n) + "] - ";
                                coverNodes.add(n);
                            }
                            chains.add(relationChain.substring(0, relationChain.length() - 3));
                        } else {
                            List<String> newPath = new ArrayList<String>();
                            newPath.addAll(path);
                            newPath.add(next);
                            queue.add(newPath);
                        }
                    }
                } else {
                    String relationChain = "";
                    for (String n : path) {
                        relationChain += "[" + classNameMap.get(n) + "] - ";
                        coverNodes.add(n);
                    }
                    chains.add(relationChain.substring(0, relationChain.length() - 3));
                }
            }
        }

        while (true) {
            int removeIndex = -1;
            for (int i = 0; i < chains.size() - 1; i++) {
                String a = chains.get(i);
                for (int j = i + 1; j < chains.size(); j++) {
                    String b = chains.get(j);
                    if (a.contains(b)) {
                        removeIndex = j;
                        break;
                    } else if (b.contains(a)) {
                        removeIndex = i;
                        break;
                    }
                }
                if (removeIndex >= 0) {
                    break;
                }
            }
            if (removeIndex >= 0) {
                chains.remove(removeIndex);
            } else {
                break;
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("relationship chain:\n");
        for (String chain : chains) {
            sb.append(chain + "\n");
        }
        String prompt = sb.toString();
        log.info("relationChain prompt:");
        log.info(prompt);
        return prompt;
    }


    /**This function generates the description information of database class definitions, relationship definitions and relationship chains according to the passed-in class name list and configuration information,
     * and returns it in the form of key-value pairs. The main functions include:
     * Read the JSON rule file, parse the dataset description, class definitions and relationship rules.
     * Build the relationship graph between classes and traverse it to find all related classes and relationships.
     * Generate the DDL definitions and sample data of the classes.
     * Generate relationship type definitions and relationship chain descriptions.
     * @param classes
     * @param adapter supplies the sample data
     * @return
     */
    public static Map<String, String> getClassDefWord(Map<String, Object> jsonRule, List<String> classes, DataAdapter adapter) {

        Map<String, String> mapDBClassesSchema =  new HashMap<String, String>();

        String datasetDesc = (String)jsonRule.get("datasetdesc");
        mapDBClassesSchema.put(KEY_DATASET_DESC, datasetDesc);

        // Get the relationship rule configuration from the JSON rule
        Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");

        // Build the relationship map between classes: key is the class name, value is the other classes related to this class and their relationship list
        Map<String, Map<String, List<String>>> classOthersMap = new HashMap<String, Map<String, List<String>>>();

        // Store the mapping from full relationship names to relationship types
        Map<String, String> fullRelMap = new HashMap<String, String>();

        // Traverse all relationship rules and build the class relationship graph
        for (String relationName : relationship_rule.keySet()) {
            Map<String, String> obj = (Map<String, String>)relationship_rule.get(relationName);
            String source = obj.get("fromclass");  // source class
            String target = obj.get("toclass");    // target class
            String desc = obj.get("desc");         // relationship description

            // Add the relationship with the target class to the source class
            Map<String, List<String>> sourceOtherMap = classOthersMap.get(source);
            if (sourceOtherMap == null) {
                sourceOtherMap = new HashMap<String, List<String>>();
                classOthersMap.put(source, sourceOtherMap);
            }
            List<String> sourceOthers = sourceOtherMap.get(target);
            if (sourceOthers == null) {
                sourceOthers = new ArrayList<String>();
                sourceOtherMap.put(target, sourceOthers);
            }
            sourceOthers.add(source + "_" + relationName + "_" + target);

            // Add the relationship with the source class to the target class (bidirectional relationship)
            Map<String, List<String>> targetOtherMap = classOthersMap.get(target);
            if (targetOtherMap == null) {
                targetOtherMap = new HashMap<String, List<String>>();
                classOthersMap.put(target, targetOtherMap);
            }
            List<String> targetOthers = targetOtherMap.get(source);
            if (targetOthers == null) {
                targetOthers = new ArrayList<String>();
                targetOtherMap.put(source, targetOthers);
            }
            targetOthers.add(source + "_" + relationName + "_" + target);

            // Store the mapping from full relationship names to relationship types
            fullRelMap.put(source + "_" + relationName + "_" + target, relationName);
        }

        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        List<String> classNames = classes;

        List<String> defClasslist = (List<String>)jsonRule.get("classlist");
        List<String> newClassNames = new ArrayList<String>();
        if(classNames != null && classNames.size() > 0){
            for (String className : classNames) {
                className = className.trim();
                if (!className.startsWith("/")) {
                    className = "/" + className;
                }
                if (className.endsWith("/")) {
                    className = className.substring(0, className.length() - 1);
                }
                if (defClasslist.contains(className)) {
                    newClassNames.add(className);
                }
            }
        }

        classNames = newClassNames;
        if (classNames.size() == 0) {
            classNames = defClasslist;
        }

        // Store all related class names and relationships
        Set<String> classNameSet = new HashSet<String>();
        Set<String> fullRelSet = new HashSet<String>();

        // Perform graph traversal for each root class to find all related classes and relationships
        for (String root : classNames) {
            classNameSet.add(root);
            // Get the other classes directly related to the root class
            Map<String, List<String>> oneLevelMap = classOthersMap.get(root);
            if (oneLevelMap != null) {
                for (String other : oneLevelMap.keySet()) {
                    classNameSet.add(other);
                    fullRelSet.addAll(oneLevelMap.get(other));
                }
            }

            // Traverse the class relationship graph using breadth-first search
            List<List<Object>> queue = new ArrayList<List<Object>>();
            List<Object> rootPath = new ArrayList<Object>();
            rootPath.add(root);
            queue.add(rootPath);

            while (queue.size() > 0) {
                List<Object> path = queue.remove(0);
                String last = (String)path.get(path.size() - 1);
                Map<String, List<String>> nextMap = classOthersMap.get(last);

                if (nextMap != null) {
                    for (String next : nextMap.keySet()) {
                        List<String> rels = nextMap.get(next);

                        // If the next class is one of the target classes, record all classes and relationships on the path
                        if (classNames.contains(next)) {
                            for (int i = 0; i < path.size(); i += 2) {
                                classNameSet.add((String)path.get(i));
                            }
                            classNameSet.add(next);
                            for (int i = 1; i < path.size(); i += 2) {
                                fullRelSet.addAll((List<String>)path.get(i));
                            }
                            fullRelSet.addAll(rels);
                        } else {
                            // Check whether a cycle is formed to avoid infinite traversal
                            boolean cycle = false;
                            for (int i = 0; i < path.size(); i += 2) {
                                if (next.equals(path.get(i))) {
                                    cycle = true;
                                    break;
                                }
                            }

                            // If there is no cycle, continue the traversal
                            if (!cycle) {
                                List<Object> newPath = new ArrayList<Object>();
                                for (Object o : path) {
                                    newPath.add(o);
                                }
                                newPath.add(rels);
                                newPath.add(next);
                                queue.add(newPath);
                            }
                        }
                    }
                }
            }
        }

        // Build the final class definition string
        StringBuffer sbMarkDownClassDefs =  new StringBuffer();

        // Add the DDL definitions of all related classes
        Map<String, String> classNameMap = new HashMap<String, String>();
        for (String className : classNameSet) {
            Map<String, Object> def = null;
            for (Map<String, Object> d : classDefs) {
                if (className.equals(d.get("className"))) {
                    def = d;
                    break;
                }
            }
            
            sbMarkDownClassDefs.append(generateMarkDownByClassDef(def));
            sbMarkDownClassDefs.append("\n");
            classNameMap.put((String)def.get("className"), (String)def.get("classDesc"));
        }



        sbMarkDownClassDefs.append("sample data:\n");
        // Add the sample data of all related classes
        for (String className : classNameSet) {
        	List<String> attrs = new ArrayList<String>();
            for (Map<String, Object> d : classDefs) {
                if (className.equals(d.get("className"))) {
                    for (Object a : (List)d.get("attrs")) {
                    	Map<String, Object> attrDef = (Map<String, Object>)a;
                        Boolean enable = (Boolean)attrDef.get("enable");
                        if(enable == null || enable == true){
                            attrs.add(String.valueOf(attrDef.get("name")));
                        }
                    }
                    break;
                }
            }
            sbMarkDownClassDefs.append(className + " sample data:\n```json\n" + HttpRequestUtil.getSampleDataByClassName(adapter, className, attrs) + "\n```\n");
        }

        // Add class definitions and sample data
        mapDBClassesSchema.put(KEY_CLASS_DEF, sbMarkDownClassDefs.toString());

        // Deduplicate and add relationship type definitions
        Set<String> relSet = new HashSet<String>();
        for (String fullName : fullRelSet) {
            relSet.add(fullRelMap.get(fullName));
        }
        StringBuffer sbMarkDownRelationDefs = new StringBuffer();
        sbMarkDownRelationDefs.append("| source class | target class | relationship type | relationship description |\n");
        sbMarkDownRelationDefs.append("| ---------- | ---------- | ---------- | -------------------- |\n");
        Map<String, Set<String>> nextMap = new HashMap<String, Set<String>>();
        for (String relName : relSet) {
            Map<String, String> rel = (Map<String, String>)relationship_rule.get(relName);
            sbMarkDownRelationDefs.append("| ").append(rel.get("fromclass"))
                    .append(" | ").append(rel.get("toclass"))
                    .append(" | ").append(relName)
                    .append(" | ").append(rel.get("desc"))
                    .append(" |\n");
            Set<String> nexts0 = nextMap.get(rel.get("fromclass"));
            if (nexts0 == null) {
                nexts0 = new HashSet<String>();
                nextMap.put(rel.get("fromclass"), nexts0);
            }
            nexts0.add(rel.get("toclass"));
            Set<String> nexts1 = nextMap.get(rel.get("toclass"));
            if (nexts1 == null) {
                nexts1 = new HashSet<String>();
                nextMap.put(rel.get("toclass"), nexts1);
            }
            nexts1.add(rel.get("fromclass"));
        }
        sbMarkDownRelationDefs.append("\n");

        mapDBClassesSchema.put(KEY_RELATIONSHIP_DEF, sbMarkDownRelationDefs.toString());

        // Generate the long relationship chain
//        String strRelationLongChain = generateRelationLongChain(classNameMap, nextMap);
//        mapDBClassesSchema.put(KEY_RELATIONSHIP_CHAIN, strRelationLongChain);


        return mapDBClassesSchema;
    }
    
    public static String generateMarkDownByClassName(String className, Map<String, Object> jsonRule) throws Exception {
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
    	Map<String, Object> def = null;
    	for (Map<String, Object> classDef : classDefs) {
    		if (className.trim().equals(classDef.get("className"))) {
                def = classDef;
                break;
            }
    	}
    	if (def != null) {
    		return generateMarkDownByClassDef(def);
    	} else {
    		return "Object class `" + className + "` does not exist";
    	}
    }
}
