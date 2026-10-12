package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.StarChartDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslPermissionUtil;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.util.HttpRequestUtil;

import cn.hutool.core.lang.UUID;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class DataServiceImpl implements DataService {
	
	@Autowired
    DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private StarChartDao starChartDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Autowired
	private AdminService adminService;
	
	@Autowired
	private LangService langService;
	
	@Autowired
	private DomainSvc domainSvc;
	
	private static final String MODE_0 = "mode0";
	private static final String MODE_1 = "mode1";

	private static final String STATUS_READY = "READY";
	private static final String STATUS_GENERATING = "GENERATING";
	private static final String STATUS_NOT_GENERATED = "NOT_GENERATED";
	private static final String STATUS_GENERATED = "GENERATED";

	// Current A/B file suffix per domain; absent means the domain has no current data in this process.
	// Package-visible so focused unit tests can drive the read states without a database.
	final Map<String, String> currentSuffix = new ConcurrentHashMap<>();
	// Domains with a generation in progress; guarantees at most one generation per domain at a time.
	// Package-visible so focused unit tests can drive the read states without a database.
	final Set<String> generatingDomains = ConcurrentHashMap.newKeySet();
	private final Map<String, InstanceGraphIndex> instanceGraphIndexes = new ConcurrentHashMap<>();
	@Autowired
	private LiveInstanceGraph liveInstanceGraph;
	
	public void initService() {
		// Legacy star-chart files are generated only by the explicit refresh endpoint.
	}

	@Override
	public JSONObject refreshStarChartData(String domainId) {
		if (!generatingDomains.add(domainId)) {
			JSONObject ret = new JSONObject();
			ret.put("success", true);
			ret.put("status", STATUS_GENERATING);
			return ret;
		}
		try {
			generate(domainId);
		} finally {
			generatingDomains.remove(domainId);
		}
		JSONObject ret = new JSONObject();
		ret.put("success", true);
		ret.put("status", STATUS_GENERATED);
		return ret;
	}

	@Override
	public JSONObject queryWholeDataMode0(String domainId) {
		return queryWholeData(MODE_0, domainId);
	}

	@Override
	public JSONObject queryWholeDataMode1(String domainId) {
		return queryWholeData(MODE_1, domainId);
	}

	private JSONObject queryWholeData(String mode, String domainId) {
		JSONObject ret = new JSONObject();
		ret.put("success", true);
		String suffix = currentSuffix.get(domainId);
		if (suffix != null) {
			JSONObject data = starChartDao.readWholeData(mode, suffix, domainId);
			ret.put("status", STATUS_READY);
			ret.put("data", data);
			return ret;
		}
		ret.put("status", generatingDomains.contains(domainId) ? STATUS_GENERATING : STATUS_NOT_GENERATED);
		return ret;
	}

	private void generate(String domainId) {
		JSONObject wholeData = cutWholeData(domainId, businessConfigService.get(domainId));
		String suffix = currentSuffix.get(domainId);
		String newSuffix = suffix == null ? "A" : (suffix.equals("A") ? "B" : "A");
		log.info("generate star chart data writeWholeData start...");
		starChartDao.writeWholeData(wholeData, MODE_0, newSuffix, domainId);
		starChartDao.writeWholeData(fromMode0ToMode1(wholeData, domainId), MODE_1, newSuffix, domainId);
		log.info("generate star chart data writeWholeData end...");
		InstanceGraphIndex index = new InstanceGraphIndex(wholeData);
		currentSuffix.put(domainId, newSuffix);
		instanceGraphIndexes.put(domainId, index);
	}

	@Override
	public JSONObject queryInstanceGraph(String operation, JSONObject request, String domainId) {
		if (liveInstanceGraph != null) return liveInstanceGraph.query(operation, request, domainId);
		JSONObject ret = new JSONObject();
		ret.put("success", true);
		InstanceGraphIndex index = instanceGraphIndexes.get(domainId);
		if (index == null) {
			ret.put("status", generatingDomains.contains(domainId) ? STATUS_GENERATING : STATUS_NOT_GENERATED);
			return ret;
		}
		String version = request.getString("version");
		if (!"summary".equals(operation) && (version == null || !version.equals(index.version))) {
			ret.put("success", false);
			ret.put("code", "GRAPH_VERSION_CHANGED");
			ret.put("message", "Graph version changed. Refresh the overview before exploring.");
			return ret;
		}
		try {
			JSONObject data = switch (operation) {
				case "summary" -> index.summary();
				case "search" -> index.search(request);
				case "neighborhood" -> index.neighborhood(request);
				default -> throw new IllegalArgumentException("Unknown graph operation");
			};
			ret.put("status", STATUS_READY);
			ret.put("data", data);
		} catch (IllegalArgumentException e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	private JSONObject buildStarChartData(Map<String, JSONObject> nodeMap, Map<String, Set<String>> sourceTargetsMap, Map<String, Set<String>> targetSourcesMap, Set<String> roots) {
		Map<String, Set<String>> rootSourceTargetsMap = new HashMap<String, Set<String>>();
		Map<String, Set<String>> rootTargetSourcesMap = new HashMap<String, Set<String>>();
		for (String root : roots) {
			String prefix = root.substring(0, root.indexOf(":"));
			Set<String> rootTargets = new HashSet<String>();
			Set<String> targets = sourceTargetsMap.get(root);
			if (targets != null) {
				for (String target : targets) {
					if (target.startsWith(prefix + ":")) {
						rootTargets.add(target);
					}
				}
			}
			rootSourceTargetsMap.put(root, rootTargets);
			
			Set<String> rootSources = new HashSet<String>();
			Set<String> sources = targetSourcesMap.get(root);
			if (sources != null) {
				for (String source : sources) {
					if (source.startsWith(prefix + ":")) {
						rootSources.add(source);
					}
				}
			}
			rootTargetSourcesMap.put(root, rootSources);
		}
		List<String> minSources = new ArrayList<String>();
		List<String> minTargets = new ArrayList<String>();
		for (String root : roots) {
			if (minSources.size() == 0) {
				minSources.add(root);
			} else {
				if (rootSourceTargetsMap.get(root).size() < rootSourceTargetsMap.get(minSources.get(0)).size()) {
					minSources = new ArrayList<String>();
					minSources.add(root);
				} else if (rootSourceTargetsMap.get(root).size() == rootSourceTargetsMap.get(minSources.get(0)).size()) {
					minSources.add(root);
				}
			}
			if (minTargets.size() == 0) {
				minTargets.add(root);
			} else {
				if (rootTargetSourcesMap.get(root).size() < rootTargetSourcesMap.get(minTargets.get(0)).size()) {
					minTargets = new ArrayList<String>();
					minTargets.add(root);
				} else if (rootTargetSourcesMap.get(root).size() == rootTargetSourcesMap.get(minTargets.get(0)).size()) {
					minTargets.add(root);
				}
			}
		}
		JSONObject virtualRootObj = new JSONObject();
		virtualRootObj.put("id", "root");
		virtualRootObj.put("name", "root");
		virtualRootObj.put("class", "virtual_root");
		virtualRootObj.put("isCenter", true);
		String centerId = null;
		if (minTargets.size() <= minSources.size()) {
			if (minTargets.size() == 1) {
				centerId = minTargets.get(0);
				nodeMap.get(centerId).put("isCenter", true);
			} else {
				centerId = virtualRootObj.getString("id");
				nodeMap.put(centerId, virtualRootObj);
				Set<String> targets = new HashSet<String>();
				for (String minTarget : minTargets) {
					Set<String> sources = targetSourcesMap.get(minTarget);
					if (sources == null) {
						sources = new HashSet<String>();
						targetSourcesMap.put(minTarget, sources);
					}
					sources.add(centerId);
					targets.add(minTarget);
				}
				sourceTargetsMap.put(centerId, targets);
			}
		} else {
			if (minSources.size() == 1) {
				centerId = minSources.get(0);
				nodeMap.get(centerId).put("isCenter", true);
			} else {
				centerId = virtualRootObj.getString("id");
				nodeMap.put(centerId, virtualRootObj);
				Set<String> sources = new HashSet<String>();
				for (String minSource : minSources) {
					Set<String> targets = sourceTargetsMap.get(minSource);
					if (targets == null) {
						targets = new HashSet<String>();
						sourceTargetsMap.put(minSource, targets);
					}
					targets.add(centerId);
					sources.add(minSource);
				}
				targetSourcesMap.put(centerId, sources);
			}
		}
		
		JSONObject data = new JSONObject();
		JSONArray nodes = new JSONArray();
		for (String key : nodeMap.keySet()) {
			JSONObject node = nodeMap.get(key);
			nodes.add(node);
		}
		data.put("nodes", nodes);
		JSONArray edges = new JSONArray();
		for (String source : sourceTargetsMap.keySet()) {
			Set<String> targets = sourceTargetsMap.get(source);
			for (String target : targets) {
				JSONObject edge = new JSONObject();
				edge.put("source", source);
				edge.put("target", target);
				edges.add(edge);
			}
		}
		data.put("edges", edges);
		log.info("buildStarChartData end...");
		
		return data;
	}
	
	/**
	 * The instance graph of every adapter: each in-chart class and relationship becomes a graph-pattern DSL run through
	 * the domain's adapter. Node ids are {@code className:primaryKeyValue}, the form queryInfoByNode reads back.
	 * Package-visible so focused unit tests can stub the data build without a database or remote query.
	 */
	JSONObject cutWholeData(String domainId, BusinessConfig businessConfig) {
		log.info("cutWholeData start...");
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map relationship_rule = (Map)jsonRule.get("relationship_rule");
		String rootClass = ((List<?>)jsonRule.get("classlist")).isEmpty() ? "" : (String)((List)jsonRule.get("classlist")).get(0);
		
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);
		
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
		for (Map<String, Object> classDef : classDefs) {
			classDefMap.put((String)classDef.get("className"), classDef);
		}
		
		Map<String, JSONObject> nodeMap = new HashMap<String, JSONObject>();
		Map<String, Set<String>> sourceTargetsMap = new HashMap<String, Set<String>>();
		Map<String, Set<String>> targetSourcesMap = new HashMap<String, Set<String>>();
		Set<String> roots = new HashSet<String>();
		JSONArray typedEdges = new JSONArray();
		JSONArray failures = new JSONArray();
		scanInstanceNodes(adapter, classDefs, nodeMap, roots, rootClass, failures);
		for (Object key : relationship_rule.keySet()) {
			try {
				Map edgeDef = (Map)relationship_rule.get(key);
				Map<String, Object> sourceClassDef = classDefMap.get(edgeDef.get("fromclass"));
				Map<String, Object> targetClassDef = classDefMap.get(edgeDef.get("toclass"));
				if (sourceClassDef != null && targetClassDef != null
						&& sourceClassDef.get("inStarChart") != null && sourceClassDef.get("inStarChart") instanceof Boolean && (Boolean)sourceClassDef.get("inStarChart")
						&& targetClassDef.get("inStarChart") != null && targetClassDef.get("inStarChart") instanceof Boolean && (Boolean)targetClassDef.get("inStarChart")) {
					String fromClass = (String)sourceClassDef.get("className");
					String toClass = (String)targetClassDef.get("className");
					String fromPk = DslUtil.getPrimaryKey(sourceClassDef);
					String fromName = getNameField(sourceClassDef);
					String toPk = DslUtil.getPrimaryKey(targetClassDef);
					String toName = getNameField(targetClassDef);
					
					JSONObject dsl = new JSONObject();
					dsl.put("problem", "");
					JSONObject answer = new JSONObject();
					JSONArray steps = new JSONArray();
					JSONObject step = new JSONObject();
					JSONObject graph = new JSONObject();
					JSONArray patterns = new JSONArray();
					JSONObject pattern = new JSONObject();
					JSONArray objects = new JSONArray();
					JSONObject fromObj = new JSONObject();
					fromObj.put("idx", 0);
					fromObj.put("variable", "f");
					fromObj.put("class", fromClass);
					objects.add(fromObj);
					JSONObject toObj = new JSONObject();
					toObj.put("idx", 1);
					toObj.put("variable", "t");
					toObj.put("class", toClass);
					objects.add(toObj);
					pattern.put("objects", objects);
					JSONArray relationship = new JSONArray();
					JSONObject rel = new JSONObject();
					rel.put("from", 0);
					rel.put("to", 1);
					JSONArray types = new JSONArray();
					types.add(key);
					rel.put("type", types);
					rel.put("min_hops", 1);
					rel.put("max_hops", 1);
					relationship.add(rel);
					pattern.put("relationship", relationship);
					patterns.add(pattern);
					graph.put("patterns", patterns);
					graph.put("pattern_logic", "and");
					step.put("graph", graph);
					JSONObject output = new JSONObject();
					output.put("to_user", true);
					JSONArray fields = new JSONArray();
					JSONObject field0 = new JSONObject();
					field0.put("variable", "f");
					field0.put("field", fromPk);
					field0.put("as", "sid");
					fields.add(field0);
					JSONObject field1 = new JSONObject();
					field1.put("variable", "f");
					field1.put("field", fromName);
					field1.put("as", "sname");
					fields.add(field1);
					JSONObject field2 = new JSONObject();
					field2.put("variable", "t");
					field2.put("field", toPk);
					field2.put("as", "tid");
					fields.add(field2);
					JSONObject field3 = new JSONObject();
					field3.put("variable", "t");
					field3.put("field", toName);
					field3.put("as", "tname");
					fields.add(field3);
					output.put("fields", fields);
					step.put("output", output);
					steps.add(step);
					answer.put("steps", steps);
					dsl.put("answer", answer);
					
					JSONArray dsls = new JSONArray();
					dsls.add(dsl);
					String sessionId = UUID.randomUUID().toString();
					List<String> generatedMqls = new ArrayList<String>();
					String result = adapter.executeDsl(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, DslExecutionMode.RAW, generatedMqls);
					JSONArray answers = JSONArray.parseArray(result);
					JSONArray rows = answers.getJSONObject(0).getJSONArray("answer");
					for (int i = 0; i < rows.size(); i++) {
						JSONObject row = rows.getJSONObject(i);
						String sourceId = row.getString("sid");
						String sourceName = row.getString("sname");
						String targetId = row.getString("tid");
						String targetName = row.getString("tname");
						
						String sourceNodeId = fromClass + ":" + sourceId;
						String targetNodeId = toClass + ":" + targetId;
						
						JSONObject sourceObj = new JSONObject();
						sourceObj.put("id", sourceNodeId);
						sourceObj.put("name", sourceName);
						sourceObj.put("class", fromClass);
						nodeMap.putIfAbsent(sourceNodeId, sourceObj);
						
						JSONObject targetObj = new JSONObject();
						targetObj.put("id", targetNodeId);
						targetObj.put("name", targetName);
						targetObj.put("class", toClass);
						nodeMap.putIfAbsent(targetNodeId, targetObj);
						typedEdges.add(JSONObject.of("source", sourceNodeId, "target", targetNodeId,
								"type", key.toString(), "label", edgeDef.get("desc")));
						
						if (rootClass.equals(fromClass)) {
							roots.add(sourceNodeId);
						}
						if (rootClass.equals(toClass)) {
							roots.add(targetNodeId);
						}
						
						Set<String> targets = sourceTargetsMap.get(sourceNodeId);
						if (targets == null) {
							targets = new HashSet<String>();
							sourceTargetsMap.put(sourceNodeId, targets);
						}
						targets.add(targetNodeId);
						
						Set<String> sources = targetSourcesMap.get(targetNodeId);
						if (sources == null) {
							sources = new HashSet<String>();
							targetSourcesMap.put(targetNodeId, sources);
						}
						sources.add(sourceNodeId);
					}
				}
			} catch (Exception e) {
				failures.add("relationship:" + key);
				log.error(e.getMessage(), e);
			}
		}
		log.info("cutWholeData end...");
		
		JSONObject graphData;
		if (roots.isEmpty()) {
			graphData = JSONObject.of("nodes", new JSONArray(nodeMap.values()), "edges", new JSONArray());
		} else {
			graphData = buildStarChartData(nodeMap, sourceTargetsMap, targetSourcesMap, roots);
		}
		graphData.put("edges", typedEdges);
		graphData.put("complete", failures.isEmpty());
		graphData.put("failures", failures);
		return graphData;
	}
	
	private void scanInstanceNodes(DataAdapter adapter, List<Map<String, Object>> classDefs,
			Map<String, JSONObject> nodeMap, Set<String> roots, String rootClass, JSONArray failures) {
		for (Map<String, Object> classDef : classDefs) {
			if (!Boolean.TRUE.equals(classDef.get("inStarChart"))) continue;
			String className = (String) classDef.get("className");
			try {
				String pk = DslUtil.getPrimaryKey(classDef);
				JSONArray fields = JSONArray.of(JSONObject.of("variable", "n", "field", pk, "as", "pk"),
						JSONObject.of("variable", "n", "field", getNameField(classDef), "as", "name"));
				JSONObject step = JSONObject.of("graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects",
						JSONArray.of(JSONObject.of("idx", 0, "variable", "n", "class", className)))), "pattern_logic", "and"),
						"output", JSONObject.of("to_user", true, "fields", fields));
				JSONObject dsl = JSONObject.of("problem", "", "answer", JSONObject.of("steps", JSONArray.of(step)));
				String result = adapter.executeDsl(JSONArray.of(dsl).toJSONString(), UUID.randomUUID().toString(), DslExecutionMode.RAW, new ArrayList<>());
				for (Object raw : JSONArray.parseArray(result).getJSONObject(0).getJSONArray("answer")) {
					JSONObject row = (JSONObject) raw;
					String id = className + ":" + row.getString("pk");
					String name = row.getString("name");
					JSONObject node = JSONObject.of("id", id, "class", className, "name", name);
					nodeMap.put(id, node);
					if (rootClass.equals(className)) roots.add(id);
				}
			} catch (Exception e) {
				failures.add("class:" + className);
				log.error("Instance graph class scan failed: {}", className, e);
			}
		}
	}

	private String getNameField(Map<String, Object> classDef) {
		String primaryKey = DslUtil.getPrimaryKey(classDef);
		if (classDef.get("attrs") instanceof List<?> attrs) {
			for (Object raw : attrs) {
				Map<?, ?> attr = (Map<?, ?>) raw;
				String name = (String) attr.get("name");
				if (!Boolean.FALSE.equals(attr.get("enable")) && !primaryKey.equals(name)
						&& Boolean.TRUE.equals(attr.get("bizzkey")) && ("name".equals(name) || name.endsWith("_name"))) return name;
			}
		}
		String pk = "id";
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
						pk = (String)attrDef.get("name");
					}
					if (attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey")) {
						return (String)attrDef.get("name");
					}
				}
			}
		}
		return pk;
	}
	
	private JSONObject fromMode0ToMode1(JSONObject wholeData, String domainId) {
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
		for (Map<String, Object> classDef : classDefs) {
			classDefMap.put((String)classDef.get("className"), classDef);
		}
		Map relationship_rule = (Map)jsonRule.get("relationship_rule");
		String rootClass = (String)((List)jsonRule.get("classlist")).get(0);
		
		Map<String, JSONObject> nodeMap = new HashMap<String, JSONObject>();
		Map<String, Set<String>> classNameNodeIds = new HashMap<String, Set<String>>();
		JSONArray nodes = wholeData.getJSONArray("nodes");
		for (int i = 0; i < nodes.size(); i++) {
			JSONObject node = nodes.getJSONObject(i);
			String className = node.getString("class");
			if (classDefMap.containsKey(className)) {
				String id = node.getString("id");
				nodeMap.put(id, node);
				Set<String> nodeIds = classNameNodeIds.get(className);
				if (nodeIds == null) {
					nodeIds = new HashSet<String>();
					classNameNodeIds.put(className, nodeIds);
				}
				nodeIds.add(id);
			}
		}
		
		JSONObject ret = new JSONObject();
		
		JSONArray classes = new JSONArray();
		for (String className : classNameNodeIds.keySet()) {
			String showName = (String)classDefMap.get(className).get("showName");
			JSONObject classObj = new JSONObject();
			classObj.put("class", className);
			classObj.put("showName", showName);
			JSONArray children = new JSONArray();
			for (String nodeId : classNameNodeIds.get(className)) {
				JSONObject node = nodeMap.get(nodeId);
				children.add(node);
			}
			classObj.put("nodes", children);
			classes.add(classObj);
		}
		ret.put("classes", classes);
		
		JSONArray relationships = new JSONArray();
		for (Object key : relationship_rule.keySet()) {
			Map rel = (Map)relationship_rule.get(key);
			if (classNameNodeIds.containsKey(rel.get("fromclass")) && classNameNodeIds.containsKey(rel.get("toclass"))) {
				JSONObject relationship = new JSONObject();
				relationship.put("source", rel.get("fromclass"));
				relationship.put("target", rel.get("toclass"));
				relationships.add(relationship);
			}
		}
		ret.put("relationships", relationships);
		
		ret.put("rootClass", rootClass);
		
		return ret;
	}

	@Override
	public JSONObject queryInfoByNode(JSONObject node, String lang, UserDataPermission permission, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		try {
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Object> classDef = null;
			for (Map<String, Object> d : classDefs) {
				if (node.getString("class").equals(d.get("className"))) {
					classDef = d;
					break;
				}
			}
			
			// The instance graph names a node className:primaryKeyValue.
			String pkField = DslUtil.getPrimaryKey(classDef);
			String pkValue = node.getString("id").substring(node.getString("class").length() + 1);
			
			JSONArray dsls = new JSONArray();
			JSONObject dsl = new JSONObject();
			dsl.put("problem", "");
			JSONObject answer = new JSONObject();
			JSONArray steps = new JSONArray();
			JSONObject step = new JSONObject();
			JSONObject graph = new JSONObject();
			JSONArray patterns = new JSONArray();
			JSONObject pattern = new JSONObject();
			JSONArray objects = new JSONArray();
			JSONObject object = new JSONObject();
			object.put("idx", 0);
			object.put("variable", "variable");
			object.put("class", classDef.get("className"));
			JSONObject conditions = new JSONObject();
			JSONObject properties = new JSONObject();
			properties.put("field", pkField);
			properties.put("operator", "=");
			properties.put("value", pkValue);
			conditions.put("properties", properties);
			object.put("conditions", conditions);
			objects.add(object);
			pattern.put("objects", objects);
			patterns.add(pattern);
			graph.put("patterns", patterns);
			graph.put("pattern_logic", "and");
			step.put("graph", graph);
			JSONObject output = new JSONObject();
			output.put("to_user", true);
			JSONArray fields = new JSONArray();
			for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					JSONObject field = new JSONObject();
					field.put("variable", "variable");
					field.put("field", attrDef.get("name"));
					field.put("as", attrDef.get("name"));
					fields.add(field);
				}
			}
			output.put("fields", fields);
			step.put("output", output);
			steps.add(step);
			answer.put("steps", steps);
			dsl.put("answer", answer);
			dsls.add(dsl);
			DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), UUID.randomUUID().toString(), false, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
			Map<String, Object> dataMap = results[0].rawResponse();
			Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
			
			if (dataMap.get("data") != null 
					&& ((List)dataMap.get("data")).size() > 0 
					&& ((Map)((List)dataMap.get("data")).get(0)).get("answer") != null
					&& ((List)((Map)((List)dataMap.get("data")).get(0)).get("answer")).size() > 0) {
				if (rowPermissionDataMap.get("data") != null 
						&& ((List)rowPermissionDataMap.get("data")).size() > 0 
						&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
						&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
					JSONObject rowPermissionDataMapJson = JSONObject.parseObject(JSON.toJSONString(rowPermissionDataMap, Feature.WriteMapNullValue));
					JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(rowPermissionDataMapJson, permission, classDefs);
					JSONObject d = new JSONObject();
					d.put("classDef", classDef);
					d.put("data", rowColPermissionDataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer").getJSONObject(0));
					ret.put("data", d);
					ret.put("success", true);
				} else {
					ret.put("message", langService.get(lang, "Data.dataPermission.noPermission"));
					ret.put("success", false);
				}
			} else {
				ret.put("message", langService.get(lang, "Data.object.notExist"));
				ret.put("success", false);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("message", langService.get(lang, "Data.query.error"));
			ret.put("success", false);
		}
		
		return ret;
	}

	@Override
	public JSONObject fullTextSearch(JSONObject textSearch, String lang, UserDataPermission permission, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String term = textSearch.get("term").toString();
		String limit = textSearch.get("limit").toString();
		int iLimit = Integer.parseInt(limit);
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		
		JSONArray allQueryData = new JSONArray();
		for(Map<String, Object> classDef : classDefs){
			String classDesc = (String)classDef.get("showName");
			String className = (String)classDef.get("className");
			String pk = "id";
			for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	        	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
	        		if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
	        			pk = (String)attrDef.get("name");
	        		}
	        	}
	        }
			
			FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
			if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
				String sessionId = UUID.randomUUID().toString();
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
	            JSONObject conditions0 = new JSONObject();
	            JSONObject properties0 = new JSONObject();
	            properties0.put("operator", "logic");
	            JSONArray ors0 = new JSONArray();
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && ("text".equals(attrDef.get("type")) || "varchar".equals(attrDef.get("type")))) {
	            		JSONObject or0 = new JSONObject();
	            		or0.put("field", attrDef.get("name"));
	            		or0.put("operator", "like");
	            		or0.put("value", "%" + term + "%");
	            		ors0.add(or0);
	            	}
	            }
	            properties0.put("or", ors0);
	            conditions0.put("properties", properties0);
	            object0.put("conditions", conditions0);
	            objects0.add(object0);
	            pattern0.put("objects", objects0);
	            patterns0.add(pattern0);
	            graph0.put("patterns", patterns0);
	            graph0.put("pattern_logic", "and");
	            step0.put("graph", graph0);
	            JSONObject output0 = new JSONObject();
	            output0.put("to_user", false);
	            output0.put("save_table", "/t-" + sessionId);
	            JSONArray fields0 = new JSONArray();
	            boolean hasId = false;
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey")) {
	            		JSONObject field0 = new JSONObject();
	            		field0.put("variable", "variable");
	            		field0.put("field", attrDef.get("name"));
	            		field0.put("as", attrDef.get("name"));
	            		fields0.add(field0);
	            		if (pk.equals(attrDef.get("name"))) {
	            			hasId = true;
	            		}
	            	}
	            }
	            if (!hasId) {
	            	JSONObject field0 = new JSONObject();
	        		field0.put("variable", "variable");
	        		field0.put("field", pk);
	        		field0.put("as", pk);
	        		fields0.add(field0);
	            }
	            output0.put("fields", fields0);
	            step0.put("output", output0);
	            steps.add(step0);
	            JSONObject step1 = new JSONObject();
	            JSONObject graph1 = new JSONObject();
	            JSONArray patterns1 = new JSONArray();
	            JSONObject pattern1 = new JSONObject();
	            JSONArray objects1 = new JSONArray();
	            JSONObject object1 = new JSONObject();
	            object1.put("variable", "variable");
	            object1.put("class", "/t-" + sessionId);
	            objects1.add(object1);
	            pattern1.put("objects", objects1);
	            patterns1.add(pattern1);
	            graph1.put("patterns", patterns1);
	            graph1.put("pattern_logic", "and");
	            step1.put("graph", graph1);
	            JSONObject output1 = new JSONObject();
	            output1.put("to_user", true);
	            JSONArray fields1 = new JSONArray();
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey")) {
	            		JSONObject field1 = new JSONObject();
	            		field1.put("variable", "variable");
	            		field1.put("field", attrDef.get("name"));
	            		field1.put("as", attrDef.get("name"));
	            		fields1.add(field1);
	            	}
	            }
	            if (!hasId) {
	            	JSONObject field1 = new JSONObject();
	        		field1.put("variable", "variable");
	        		field1.put("field", pk);
	        		field1.put("as", pk);
	        		fields1.add(field1);
	            }
	            output1.put("fields", fields1);
	            JSONObject limit1 = new JSONObject();
	            limit1.put("offset", 0);
	            limit1.put("count", iLimit);
	            output1.put("limit", limit1);
	            step1.put("output", output1);
	            steps.add(step1);
	            answer.put("steps", steps);
	            dsl.put("answer", answer);
	            dsls.add(dsl);
	            
	            DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
	            Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
	            JSONArray rows = new JSONArray();
	            if (rowPermissionDataMap.get("data") != null 
	            		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
	            		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
	            		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
	            	List _rows = (List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer");
	            	for (Object _row : _rows) {
	            		Map<String, Object> row = (Map<String, Object>)_row;
	            		row.put("classDesc", classDesc);
	            		row.put("className", className);
	            		rows.add(row);
	            	}
	            }
	            allQueryData.addAll(rows);
				if(allQueryData.size() >= iLimit) {
					break;
				}
			}
		}

		if(allQueryData.size() > 0) {
			ret.put("data", allQueryData.subList(0, Math.min(allQueryData.size(), iLimit)));
		} else {
			ret.put("data", allQueryData);
		}

		ret.put("success", true);

		return ret;
	}

	@Override
	public JSONObject getClassAndCount(String lang, UserDataPermission permission, String domainId){
		JSONObject ret = new JSONObject();
		JSONArray allQueryData = new JSONArray();
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		
		for(Map<String, Object> classDef : classDefs) {
			String className = (String)classDef.get("className");
			FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
			
			if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
				Integer count = getCountByClassName(className, null, jsonRule, permission, domainId);
				Map<String,Object> classAndCount = new HashMap<String,Object>();
				classAndCount.put("className", className);
				classAndCount.put("showName", classDef.get("showName"));
				classAndCount.put("count", count);
				allQueryData.add(classAndCount);
			}
		}

		ret.put("data", allQueryData);
		ret.put("success", true);

		return ret;
	}
	
	static JSONObject buildClassQueryObject(String className, String searchTerm) {
		JSONObject object = new JSONObject();
		object.put("idx", 0);
		object.put("variable", "variable");
		object.put("class", className);
		if (searchTerm != null) {
			JSONObject conditions = new JSONObject();
			JSONObject text = new JSONObject();
			text.put("fields", new JSONArray());
			text.put("operator", "match");
			text.put("boost", 1.0);
			text.put("query", searchTerm);
			conditions.put("text", text);
			object.put("conditions", conditions);
		}
		return object;
	}

	private Integer getCountByClassName(String className, String searchTerm, Map<String, Object> jsonRule, UserDataPermission permission, String domainId) {
		Integer count = 0;
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for(Map<String, Object> mapClassDef : classDefs) {
			String classNameDef = (String) mapClassDef.get("className");
			if (classNameDef.equals(className)) {
				classDef = mapClassDef;
				break;
			}
		}
		String pk = "id";
		for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
        	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
        		if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
        			pk = (String)attrDef.get("name");
        		}
        	}
        }
		
		String sessionId = UUID.randomUUID().toString();
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
		JSONObject object0 = buildClassQueryObject(className, searchTerm);
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
		field0.put("field", pk);
		field0.put("function", "count");
		field0.put("as", "count_id");
		fields0.add(field0);
        output0.put("fields", fields0);
        step0.put("output", output0);
        steps.add(step0);
        answer.put("steps", steps);
        dsl.put("answer", answer);
        dsls.add(dsl);
        
        BusinessConfig businessConfig = businessConfigService.get(domainId);
		DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
		Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
        if (rowPermissionDataMap.get("data") != null 
        		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
        		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
        		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
        	Map<String, Object> row = (Map<String, Object>)((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).get(0);
        	try {
        		count = Integer.parseInt(row.get("count_id") + "");
        	} catch (Exception e) {}
        }
        return count;
	}
	
	@Override
	public JSONObject getClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId) {
		return getClassDataByPage(classSearch, lang, permission, true, domainId);
	}
	
	@Override
	public JSONObject getWholeClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId) {
		return getClassDataByPage(classSearch, lang, permission, false, domainId);
	}

	private JSONObject getClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, boolean withBizzKey, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
		
		JSONObject ret = new JSONObject();
		
		String className = classSearch.get("classname").toString();
		String searchTerm = classSearch.getString("search");
		if (searchTerm != null ) {
			searchTerm = searchTerm.trim();
			if ("".equals(searchTerm)) {
				searchTerm = null;
			}
		}
		int pageNum = Integer.valueOf(classSearch.get("pagenum").toString());
		int pagecount = Integer.valueOf(classSearch.get("pagecount").toString());
		int start = (pageNum-1)*pagecount <0 ? 0 : (pageNum-1)*pagecount;

		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for(Map<String, Object> mapClassDef : classDefs) {
			String classNameDef = (String) mapClassDef.get("className");
			if (classNameDef.equals(className)) {
				classDef = mapClassDef;
				break;
			}
		}
		String pk = "id";
		for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
        	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
        		if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
        			pk = (String)attrDef.get("name");
        		}
        	}
        }
		
		FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
		if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
			// Query details by page
			String sessionId = UUID.randomUUID().toString();
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
			JSONObject object0 = buildClassQueryObject(className, searchTerm);
            objects0.add(object0);
            pattern0.put("objects", objects0);
            patterns0.add(pattern0);
            graph0.put("patterns", patterns0);
            graph0.put("pattern_logic", "and");
            step0.put("graph", graph0);
            JSONObject output0 = new JSONObject();
            output0.put("to_user", true);
            JSONArray fields0 = new JSONArray();
            boolean hasId = false;
            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
            		if (withBizzKey && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey") || !withBizzKey) {
            			JSONObject field0 = new JSONObject();
                		field0.put("variable", "variable");
                		field0.put("field", attrDef.get("name"));
                		field0.put("as", attrDef.get("name"));
                		fields0.add(field0);
                		if (pk.equals(attrDef.get("name"))) {
                			hasId = true;
                		}
            		}
            	}
            }
            if (!hasId) {
            	JSONObject field0 = new JSONObject();
        		field0.put("variable", "variable");
        		field0.put("field", pk);
        		field0.put("as", pk);
        		fields0.add(field0);
            }
            
            output0.put("fields", fields0);
            JSONObject sort0 = new JSONObject();
            JSONArray sortFields0 = new JSONArray();
            JSONObject sortField0 = new JSONObject();
            sortField0.put("variable", "variable");
            sortField0.put("field", pk);
            sortField0.put("order", "asc");
            sortFields0.add(sortField0);
            sort0.put("fields", sortFields0);
            output0.put("sort", sort0);
            JSONObject limit0 = new JSONObject();
            limit0.put("offset", start);
            limit0.put("count", pagecount);
            output0.put("limit", limit0);
            step0.put("output", output0);
            steps.add(step0);
            answer.put("steps", steps);
            dsl.put("answer", answer);
            dsls.add(dsl);
            
			DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
			Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
            JSONArray rows = new JSONArray();
            if (rowPermissionDataMap.get("data") != null 
            		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
            		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
            		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
            	List _rows = (List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer");
            	for (Object _row : _rows) {
            		rows.add(_row);
            	}
            }
            
			// Query total record count
			Integer totalCount = getCountByClassName(className, searchTerm, jsonRule, permission, domainId);
            int totalPage = totalCount % pagecount == 0 ? totalCount / pagecount : totalCount / pagecount + 1;
            ret.put("data", rows);
    		ret.put("total_count", totalCount);
    		ret.put("total_page", totalPage);
    		ret.put("cur_page", pageNum);
    		ret.put("success", true);
		} else {
			ret.put("message", langService.get(lang, "Data.dataPermission.noPermission"));
			ret.put("success", false);
		}
		
		return ret;
	}
	
	@Override
	public List<String> queryDistinctAttrValue(String className, String attrName, String query, UserDataPermission permission, String domainId) throws Exception {
		List<String> values = new ArrayList<String>();
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
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
					String sessionId = UUID.randomUUID().toString();
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
			        	query = "%" + query.trim() + "%";
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
			        
			        BusinessConfig businessConfig = businessConfigService.get(domainId);
			        DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
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
				}
			}
		}
		
		return values;
	}
}
