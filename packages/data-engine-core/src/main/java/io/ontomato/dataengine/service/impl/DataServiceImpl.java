package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

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
import io.ontomato.dataengine.dao.sys.CSysDomain;
import io.ontomato.dataengine.dao.sys.SysDomain;
import io.ontomato.dataengine.dao.sys.SysDomainDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslPermissionUtil;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import cn.hutool.core.lang.UUID;
import jakarta.annotation.PostConstruct;
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
	private SysDomainDao domainDao;
	
	private BlockingQueue<WholeDataOperate> wholeDataQueue = new LinkedBlockingQueue<WholeDataOperate>();
	
	class WholeDataOperate {
		public static final String TYPE_GET = "GET";
		public static final String TYPE_CUT = "CUT";
		public static final String TYPE_PUT = "PUT";
		
		public static final String MODE_0 = "mode0";
		public static final String MODE_1 = "mode1";
		
		private String type;
		private JSONObject input;
		private BlockingQueue<JSONObject> output;
		
		public WholeDataOperate(String type, JSONObject input, BlockingQueue<JSONObject> output) {
			this.type = type;
			this.input = input;
			this.output = output;
		}
		
		public String getType() {
			return type;
		}
		public void setType(String type) {
			this.type = type;
		}
		public JSONObject getInput() {
			return input;
		}
		public void setInput(JSONObject input) {
			this.input = input;
		}
		public BlockingQueue<JSONObject> getOutput() {
			return output;
		}
		public void setOutput(BlockingQueue<JSONObject> output) {
			this.output = output;
		}
	}
	
	@PostConstruct
	public void initService() {
		new Thread(new Runnable() {
			@Override
			public void run() {
				Map<String, String> currentMap = new HashMap<String, String>();
				while (true) {
					try {
						WholeDataOperate operate = wholeDataQueue.take();
						JSONObject input = operate.getInput();
						BlockingQueue<JSONObject> output = operate.getOutput();
						if (WholeDataOperate.TYPE_GET.equals(operate.getType())) {
							String mode = input.getString("mode");
							String domainId = input.getString("domainId");
							String _current = currentMap.get(domainId) != null ? (currentMap.get(domainId) + "") : "";
							new Thread(new Runnable() {
								@Override
								public void run() {
									try {
										boolean wholeDataIsNull = true;
										if (!_current.equals("")) {
											JSONObject wholeData = starChartDao.readWholeData(mode, _current, domainId);
											if (wholeData != null) {
												output.put(wholeData);
												wholeDataIsNull = false;
											}
										}
										if (wholeDataIsNull) {
											Thread.sleep(1000);
											wholeDataQueue.put(operate);
										}
									} catch (Exception e) {
										log.error(e.getMessage(), e);
									}
								}
							}).start();
						} else if (WholeDataOperate.TYPE_CUT.equals(operate.getType())) {
							String domainId = input.getString("domainId");
							String _current = currentMap.get(domainId) != null ? (currentMap.get(domainId) + "") : "";
							new Thread(new Runnable() {
								@Override
								public void run() {
									try {
										String newCurrent = null;
										if (_current.equals("")) {
											newCurrent = "A";
										} else {
											if (_current.equals("A")) {
												newCurrent = "B";
											} else {
												newCurrent = "A";
											}
										}
										BusinessConfig businessConfig = businessConfigService.get(domainId);
										DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
										if (adapter.useM3()) {
											JSONObject wholeData = cutWholeData(domainId);
											log.info("TYPE_CUT writeWholeData start...");
											starChartDao.writeWholeData(wholeData, WholeDataOperate.MODE_0, newCurrent, domainId);
											starChartDao.writeWholeData(fromMode0ToMode1(wholeData, domainId), WholeDataOperate.MODE_1, newCurrent, domainId);
											log.info("TYPE_CUT writeWholeData end...");
										} else {
											JSONObject wholeData = cutWholeDataBySql(domainId, businessConfig);
											log.info("TYPE_CUT writeWholeData start...");
											starChartDao.writeWholeData(wholeData, WholeDataOperate.MODE_0, newCurrent, domainId);
											starChartDao.writeWholeData(fromMode0ToMode1(wholeData, domainId), WholeDataOperate.MODE_1, newCurrent, domainId);
											log.info("TYPE_CUT writeWholeData end...");
										}
										JSONObject input = new JSONObject();
										input.put("domainId", domainId);
										input.put("newCurrent", newCurrent);
										log.info("TYPE_CUT operate input start    " + input.toString());
										WholeDataOperate operate = new WholeDataOperate(WholeDataOperate.TYPE_PUT, input, null);
										wholeDataQueue.put(operate);
									} catch (Exception e) {
										log.error(e.getMessage(), e);
									}
								}
							}).start();
						} else if (WholeDataOperate.TYPE_PUT.equals(operate.getType())) {
							String domainId = input.getString("domainId");
							String current = input.getString("newCurrent");
							currentMap.put(domainId, current);
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(10);
					} catch (Exception e) {}
				}
			}
		}).start();
		
		new Thread(new Runnable() {
			@Override
			public void run() {
				while (true) {
					try {
						List<SysDomain> domains = domainDao.queryList(new CSysDomain());
						for (SysDomain domain : domains) {
							JSONObject input = new JSONObject();
							input.put("domainId", domain.getId());
							WholeDataOperate operate = new WholeDataOperate(WholeDataOperate.TYPE_CUT, input, null);
							wholeDataQueue.put(operate);
						}
						
						break;
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(5 * 60 * 1000);
					} catch (Exception e) {}
				}
			}
		}).start();
	}
	
	@Override
	public void refreshStarChartData(String domainId) {
		try {
			JSONObject input = new JSONObject();
			input.put("domainId", domainId);
			WholeDataOperate operate = new WholeDataOperate(WholeDataOperate.TYPE_CUT, input, null);
			wholeDataQueue.put(operate);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}
	
	@Override
	public JSONObject queryWholeDataMode0(String domainId) {
		return queryWholeData(WholeDataOperate.MODE_0, domainId);
	}
	
	@Override
	public JSONObject queryWholeDataMode1(String domainId) {
		return queryWholeData(WholeDataOperate.MODE_1, domainId);
	}
	
	private JSONObject queryWholeData(String mode, String domainId) {
		JSONObject data = null;
		try {
			JSONObject input = new JSONObject();
			input.put("mode", mode);
			input.put("domainId", domainId);
			BlockingQueue<JSONObject> output = new LinkedBlockingQueue<JSONObject>();
			WholeDataOperate operate = new WholeDataOperate(WholeDataOperate.TYPE_GET, input, output);
			wholeDataQueue.put(operate);
			data = output.take();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		JSONObject ret = new JSONObject();
		if (data != null) {
			ret.put("success", true);
			ret.put("data", data);
		} else {
			ret.put("success", false);
		}
		return ret;
	}
	
	private JSONObject cutWholeData(String domainId) {
		log.info("cutWholeData start...");
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map relationship_rule = (Map)jsonRule.get("relationship_rule");
		String rootClass = (String)((List)jsonRule.get("classlist")).get(0);
		
		Map<String, JSONObject> nodeMap = new HashMap<String, JSONObject>();
		Map<String, Set<String>> sourceTargetsMap = new HashMap<String, Set<String>>();
		Map<String, Set<String>> targetSourcesMap = new HashMap<String, Set<String>>();
		Set<String> roots = new HashSet<String>();
		for (Object key : relationship_rule.keySet()) {
			try {
				Map edgeDef = (Map)relationship_rule.get(key);
				Map<String, Object> sourceClassDef = null;
				Map<String, Object> targetClassDef = null;
				for (Map<String, Object> classDef : classDefs) {
					if (edgeDef.get("fromclass").equals(classDef.get("className"))) {
						sourceClassDef = classDef;
					}
					if (edgeDef.get("toclass").equals(classDef.get("className"))) {
						targetClassDef = classDef;
					}
				}
				if (sourceClassDef.get("inStarChart") != null && sourceClassDef.get("inStarChart") instanceof Boolean && (Boolean)sourceClassDef.get("inStarChart") 
						&& targetClassDef.get("inStarChart") != null && targetClassDef.get("inStarChart") instanceof Boolean && (Boolean)targetClassDef.get("inStarChart")) {
					String mql = "match (a:" + edgeDef.get("fromclass") + ")-[:" + key + "]->(b:" + edgeDef.get("toclass") + ")";
					JSONObject output = HttpRequestUtil.queryMql(dataRagConfig, mql);
					JSONArray message = output.getJSONArray("message");
					for (int i = 0; i < message.size(); i++) {
						JSONObject graph = message.getJSONObject(i).getJSONObject("graph");
						JSONArray nodes = graph.getJSONArray("nodes");
						for (int j = 0; j < nodes.size(); j++) {
							JSONObject node = nodes.getJSONObject(j);
							JSONObject obj = new JSONObject();
							obj.put("id", node.getString("id"));
							obj.put("name", node.getString("name"));
							obj.put("class", node.getString("class"));
							nodeMap.put(obj.getString("id"), obj);
							if (rootClass.equals(obj.getString("class"))) {
								roots.add(obj.getString("id"));
							}
						}
						JSONArray edges = graph.getJSONArray("edges");
						for (int j = 0; j < edges.size(); j++) {
							JSONObject edge = edges.getJSONObject(j);
							String source = edge.getString("source");
							String target = edge.getString("target");
							Set<String> targets = sourceTargetsMap.get(source);
							if (targets == null) {
								targets = new HashSet<String>();
								sourceTargetsMap.put(source, targets);
							}
							targets.add(target);
							Set<String> sources = targetSourcesMap.get(target);
							if (sources == null) {
								sources = new HashSet<String>();
								targetSourcesMap.put(target, sources);
							}
							sources.add(source);
						}
					}
				}
			} catch (Exception e) {}
		}
		
		return buildStarChartData(nodeMap, sourceTargetsMap, targetSourcesMap, roots);
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
	
	private JSONObject cutWholeDataBySql(String domainId, BusinessConfig businessConfig) {
		log.info("cutWholeDataBySql start...");
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map relationship_rule = (Map)jsonRule.get("relationship_rule");
		String rootClass = (String)((List)jsonRule.get("classlist")).get(0);
		
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);
		
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
		for (Map<String, Object> classDef : classDefs) {
			classDefMap.put((String)classDef.get("className"), classDef);
		}
		
		Map<String, JSONObject> nodeMap = new HashMap<String, JSONObject>();
		Map<String, Set<String>> sourceTargetsMap = new HashMap<String, Set<String>>();
		Map<String, Set<String>> targetSourcesMap = new HashMap<String, Set<String>>();
		Set<String> roots = new HashSet<String>();
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
					String result = adapter.executeDsl(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, null, generatedMqls);
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
						nodeMap.put(sourceNodeId, sourceObj);
						
						JSONObject targetObj = new JSONObject();
						targetObj.put("id", targetNodeId);
						targetObj.put("name", targetName);
						targetObj.put("class", toClass);
						nodeMap.put(targetNodeId, targetObj);
						
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
				log.error(e.getMessage(), e);
			}
		}
		log.info("cutWholeDataBySql end...");
		
		return buildStarChartData(nodeMap, sourceTargetsMap, targetSourcesMap, roots);
	}
	
	private String getNameField(Map<String, Object> classDef) {
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
	public JSONObject queryNextByNode(JSONObject n, String lang, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
		if (adapter.useM3()) {
			try {
				Map<String, JSONObject> nodeMap = new HashMap<String, JSONObject>();
				Map<String, String[]> edgeMap = new HashMap<String, String[]>();
				
				String[] mqls = new String[] {
						"match ('" + n.getString("id") + "')-[*1..1]->()",
						"match ('" + n.getString("id") + "')<-[*1..1]-()"
				};
				for (String mql : mqls) {
					JSONObject output = HttpRequestUtil.queryMql(dataRagConfig, mql);
					JSONArray message = output.getJSONArray("message");
					for (int i = 0; i < message.size(); i++) {
						JSONObject graph = message.getJSONObject(i).getJSONObject("graph");
						JSONArray nodes = graph.getJSONArray("nodes");
						for (int j = 0; j < nodes.size(); j++) {
							JSONObject node = nodes.getJSONObject(j);
							if (!n.getString("id").equals(node.getString("id"))) {
								JSONObject obj = new JSONObject();
								obj.put("id", node.getString("id"));
								obj.put("name", node.getString("name"));
								obj.put("class", node.getString("class"));
								nodeMap.put(obj.getString("id"), obj);
							}
						}
						JSONArray edges = graph.getJSONArray("edges");
						for (int j = 0; j < edges.size(); j++) {
							JSONObject edge = edges.getJSONObject(j);
							String source = edge.getString("source");
							String target = edge.getString("target");
							edgeMap.put(source + "_" + target, new String[] {source, target});
						}
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
				for (String key : edgeMap.keySet()) {
					String[] st = edgeMap.get(key);
					JSONObject edge = new JSONObject();
					edge.put("source", st[0]);
					edge.put("target", st[1]);
					edges.add(edge);
				}
				data.put("edges", edges);
				ret.put("success", true);
				ret.put("data", data);
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				ret.put("message", langService.get(lang, "Data.queryM3.error"));
				ret.put("success", false);
			}
		} else {
			ret.put("message", langService.get(lang, "Data.remoteDB.notSupport") + ": " + businessConfig.getDataAdapter());
			ret.put("success", false);
		}
		
		return ret;
	}

	@Override
	public JSONObject queryInfoByNode(JSONObject node, String lang, UserDataPermission permission, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, null);
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
			
			String pkField = adapter.useM3() ? "id" : DslUtil.getPrimaryKey(classDef);
			String pkValue = node.getString("id");
			if (!adapter.useM3()) {
				pkValue = pkValue.substring(node.getString("class").length() + 1);
			}
			
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
			DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), UUID.randomUUID().toString(), false, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
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
			ret.put("message", langService.get(lang, "Data.queryM3.error"));
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
	            
	            DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
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
		DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
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
            
			DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
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
			        DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
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
