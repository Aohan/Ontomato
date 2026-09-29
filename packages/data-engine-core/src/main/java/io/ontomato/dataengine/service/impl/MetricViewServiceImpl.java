package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.SubQueryWorkspaceDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.tools.MetricViewSubmitTools;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.UserMessageUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class MetricViewServiceImpl implements MetricViewService {
	
	@Autowired
	private DataRagConfig dataRagConfig;
	
	@Autowired
	private MetricViewDao metricViewDao;
	
	@Autowired
	private FunctionDao functionDao;
	
	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private KnowledgeDao knowledgeDao;
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
	private ABCProgramService abcProgramService;
	
	@Autowired
	private LangService langService;
	
	@Autowired
	private SubQueryWorkspaceDao subQueryWorkspaceDao;
	
	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
	@PostConstruct
	public void initService() {
		// Periodically clean up unpublished metricViews from 12 hours ago
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Object[]> oList = metricViewDao.queryList(null, MetricView.STATUS_PENDING_REVIEW, null, null, null);
						for (Object[] o : oList) {
							MetricView metricView = (MetricView)o[0];
							if (!MetricView.ORIGIN_SYSTEM.equals(metricView.getOrigin())) {
								if (now - metricView.getModifyTimestamp() > timeoutTimeRange) {
									metricViewDao.delete(metricView.getId());
								}
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(60000L);
					} catch (Exception e) {}
				}
			}
		}).start();
	}
	
	@Override
	public MetricView generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception {
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String port = businessConfigService.getRuntimeWholeConfig(domainId).getJSONObject("server").getInteger("port") + "";
		
		String sessionId = UUID.randomUUID().toString();
		agentWorkspaceService.createWorkspace(sessionId);
		try {
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(sessionId);
		originalQuestion.setQuestion(question);
		String userMessage = UserMessageUtil.getMetricViewMakerUserMessage(question, port, knowledgeDao, businessConfigService, lang, langService, jsonRule, domainId);
		multiThreadAIChatService.chat(
				MultiThreadAIChatService.METRIC_VIEW_MAKER,
				originalQuestion,
				sessionId,
				userMessage,
				ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
				domainId);
		// Deliveries come only from submission registration
		String submitted = agentWorkspaceService.getSubmission(sessionId);
		if (submitted == null) {
			return null;
		}
		JSONObject envelope = null;
		try {
			envelope = JSONObject.parseObject(submitted);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return null;
		}
		String code = envelope.getString(MetricViewSubmitTools.CODE_KEY);
		String name = envelope.getString(MetricViewSubmitTools.NAME_KEY);
		String logic = envelope.getString(MetricViewSubmitTools.LOGIC_KEY);
		JSONArray outKeyRefArray = envelope.getJSONArray(MetricViewSubmitTools.OUT_KEY_REFS_KEY);
		if (code == null || name == null || logic == null || outKeyRefArray == null) {
			return null;
		}
		List<Parameter> parameters = new ArrayList<Parameter>();
		if (envelope.containsKey(MetricViewSubmitTools.PARAMETER_DEFS_KEY)) {
			parameters = DBSchemaUtil.buildParameters(envelope.getJSONArray(MetricViewSubmitTools.PARAMETER_DEFS_KEY).toList(Map.class), classDefs);
		}
		List<ABCHarnessProgramOutKeyRef> outKeyRefs = new ArrayList<ABCHarnessProgramOutKeyRef>();
		for (int i = 0; i < outKeyRefArray.size(); i++) {
			JSONObject outKeyRefObj = outKeyRefArray.getJSONObject(i);
			ABCHarnessProgramOutKeyRef outKeyRef = new ABCHarnessProgramOutKeyRef();
			outKeyRef.setKey(outKeyRefObj.getString("key"));
			String className = DBSchemaUtil.normalizeClassName(outKeyRefObj.getString("className"), classDefs);
			outKeyRef.setClassName(className);
			outKeyRef.setAttrName(outKeyRefObj.getString("attrName"));
			outKeyRef.setAsGroupBy(outKeyRefObj.getBoolean("asGroupBy"));
			outKeyRef.setStatCal(outKeyRefObj.getBoolean("statCal"));
			outKeyRefs.add(outKeyRef);
		}
		Function function = new Function();
		function.setOrigin(Function.ORIGIN_USER);
		function.setOperation(Function.OPERATION_READ);
		function.setDomainId(domainId);
		function.setName(name);
		function.setParameters(parameters);
		function.setCode(code);
		function.setLogic(logic);
		
		ReturnDef returnDef = new ReturnDef();
		returnDef.setIsVoid(false);
		List<String> classNames = new ArrayList<String>();
		for (ABCHarnessProgramOutKeyRef outKeyRef : outKeyRefs) {
			if (!classNames.contains(outKeyRef.getClassName())) {
				classNames.add(outKeyRef.getClassName());
			}
		}
		returnDef.setOutKeyRefs(outKeyRefs);
		returnDef.setClassNames(classNames);
		function.setReturnDef(returnDef);
		if (persistence) {
			function = functionDao.save(function);
		}
		
		MetricView metricView = generateFromFunction(function);
		metricView.setType(MetricView.TYPE_GENERAL);
		metricView.setStatus(MetricView.STATUS_PUBLISHED);
		Set<String> matchQuestions = new HashSet<String>();
		matchQuestions.add(question);
		metricView.setMatchQuestions(matchQuestions);
		if (persistence) {
			metricView = metricViewDao.save(metricView);
		}
		return metricView;
		} finally {
			agentWorkspaceService.removeWorkspace(sessionId);
		}
	}
	
	@Override
	public MetricView generateFromFunction(Function function) {
		MetricView metricView = new MetricView();
		metricView.setName(function.getName());
		metricView.setOrigin(function.getOrigin());
		metricView.setFunction(function);
		metricView.setStatus(MetricView.STATUS_PENDING_REVIEW);
		metricView.setDomainId(function.getDomainId());
		return metricView;
	}

	@Override
	public MetricView save(MetricView metricView, String lang) throws Exception {
		if (metricView.getId() != null) {
			Object[] exist = metricViewDao.queryById(metricView.getId());
			if (exist == null) {
				throw new Exception(langService.get(lang, "MetricView.notFound"));
			} else {
				MetricView existMetricView = (MetricView)exist[0];
				if (MetricView.ORIGIN_SYSTEM.equals(existMetricView.getOrigin())) {
					throw new Exception(langService.get(lang, "MetricView.cannotModifySystem"));
				}
				if (!metricView.getDomainId().equals(existMetricView.getDomainId())) {
					throw new Exception(langService.get(lang, "MetricView.domainMismatch"));
				}
			}
		}
		if (metricView.getFunction() != null) {
			Function function = metricView.getFunction();
			if (function.getId() != null) {
				Function existFunction = functionDao.queryById(function.getId());
				if (existFunction != null) {
					if (!Function.OPERATION_READ.equals(existFunction.getOperation())) {
						throw new Exception(langService.get(lang, "Function.notRead"));
					}
				} else {
					throw new Exception(langService.get(lang, "Function.notFound"));
				}
			} else {
				if (!Function.OPERATION_READ.equals(function.getOperation())) {
					throw new Exception(langService.get(lang, "Function.notRead"));
				}
			}
			function = functionDao.save(function);
			metricView.setFunction(function);
		} else {
			throw new Exception(langService.get(lang, "Function.cannotBeEmpty"));
		}
		return metricViewDao.save(metricView);
	}

	@Override
	public void delete(String id, String lang) throws Exception {
		Object[] exist = metricViewDao.queryById(id);
		if (exist != null) {
			MetricView existMetricView = (MetricView)exist[0];
			if (MetricView.ORIGIN_SYSTEM.equals(existMetricView.getOrigin())) {
				throw new Exception(langService.get(lang, "MetricView.cannotDeleteSystem"));
			}
			metricViewDao.delete(id);
		}
	}

	@Override
	public MetricView queryById(String id) {
		Object[] o  = metricViewDao.queryById(id);
		if (o != null) {
			MetricView metricView = (MetricView)o[0];
			String functionId = (String)o[1];
			Function function = functionDao.queryById(functionId);
			metricView.setFunction(function);
			return metricView;
		} else {
			return null;
		}
	}

	@Override
	public List<MetricView> queryList(String type, String status, String functionId, String className, String domainId) {
		List<Object[]> oList = metricViewDao.queryList(type, status, functionId, className, domainId);
		List<Function> functions = functionDao.queryList(null, null, null);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<MetricView> metricViews = new ArrayList<MetricView>();
		for (Object[] o : oList) {
			MetricView metricView = (MetricView)o[0];
			String fId = (String)o[1];
			metricView.setFunction(functionMap.get(fId));
			metricViews.add(metricView);
		}
		return metricViews;
	}
	
	@Override
	public List<MetricView> find(String question, String className, String domainId) {
		List<Object[]> oList = metricViewDao.find(question, null, className, 10, 0, domainId);
		List<Function> functions = functionDao.queryList(null, null, domainId);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<MetricView> metricViews = new ArrayList<MetricView>();
		for (Object[] o : oList) {
			MetricView metricView = (MetricView)o[0];
			String functionId = (String)o[1];
			metricView.setFunction(functionMap.get(functionId));
			metricViews.add(metricView);
		}
		return metricViews;
	}
	
	@Override
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
		Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), metricView.getFunction(), user.getId(), permission, null, lang, timeoutMinutes, user.getDomainId());
		JSONArray rows = (JSONArray)o[0];
		MetricViewContent metricViewContent = generateContent(rows, metricView.getName(), metricView, lang);
		return metricViewContent;
	}

	@Override
	public List<MetricViewContent> generateGeneralContent(String sessionId, String question, String lang, User user, UserDataPermission permission, int timeoutMinutes, boolean test) {
		List<MetricViewContent> metricViewContents = new ArrayList<MetricViewContent>();
		List<Object[]> oList = metricViewDao.find(question, MetricView.TYPE_GENERAL, null, 10, 0, user.getDomainId());
		List<Function> functions = functionDao.queryList(null, null, user.getDomainId());
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<MetricView> metricViews = new ArrayList<MetricView>();
		for (Object[] o : oList) {
			try {
				MetricView metricView = (MetricView)o[0];
				String fId = (String)o[1];
				metricView.setFunction(functionMap.get(fId));
				metricViews.add(metricView);
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		
		if (metricViews.size() > 0) {
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sessionId);
			originalQuestion.setQuestion(question);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
			String userMessage = UserMessageUtil.getReadFunctionInstancerUserMessage(question, metricViews, 
					knowledgeDao, businessConfigService,
					lang, langService, jsonRule, user.getDomainId());
			String retStr = multiThreadAIChatService.chat(
					MultiThreadAIChatService.READ_FUNCTION_INSTANCER,
					originalQuestion,
					sessionId,
					userMessage,
					ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
					user.getDomainId());
			
			if (retStr.indexOf("```json") >= 0) {
				retStr = retStr.substring(retStr.indexOf("```json") + 7);
				retStr = retStr.substring(0, retStr.lastIndexOf("```"));
				JSONArray inputFunctions = JSONArray.parseArray(retStr);
				for (int i = 0; i < inputFunctions.size(); i++) {
					try {
						JSONObject inputFunction = inputFunctions.getJSONObject(i);
						String id = inputFunction.getString("id");
						String functionQuestion = inputFunction.getString("question");
						List<Parameter> parameters = inputFunction.getList("parameters", Parameter.class);
						
						MetricView metricView = null;
						for (MetricView mv : metricViews) {
							if (mv.getId().equals(id)) {
								metricView = mv;
								break;
							}
						}
						if (metricView != null) {
							Function function = metricView.getFunction();
							
							// Enrich the metricView's matchQuestions
							metricView.getMatchQuestions().add(question.trim());
							metricViewDao.save(metricView);
							
							// Generate the return content
							MetricView staticMetricView = new MetricView();
							Function staticFunction = new Function();
							staticFunction.setName(functionQuestion);
							staticFunction.setOrigin(Function.ORIGIN_USER);
							staticFunction.setOperation(Function.OPERATION_READ);
							List<Parameter> staticParameters = new ArrayList<Parameter>();
							for (Parameter originParameter : function.getParameters()) {
								Parameter parameter = null;
								for (Parameter p : parameters) {
									if (originParameter.getName().equals(p.getName())) {
										parameter = p;
										break;
									}
								}
								if (parameter != null) {
									originParameter.setValue(parameter.getValue());
								}
								staticParameters.add(originParameter);
							}
							staticFunction.setParameters(staticParameters);
							staticFunction.setReturnDef(function.getReturnDef());
							staticFunction.setCode(function.getCode());
							staticFunction.setLogic(function.getLogic());
							staticFunction.setDomainId(function.getDomainId());
							staticMetricView.setName(functionQuestion);
							staticMetricView.setOrigin(MetricView.ORIGIN_USER);
							staticMetricView.setType(MetricView.TYPE_STATIC);
							staticMetricView.setFunction(staticFunction);
							staticMetricView.setStatus(MetricView.STATUS_PENDING_REVIEW);
							Set<String> staticMatchQuestions = new HashSet<String>();
							staticMatchQuestions.add(question.trim());
							staticMetricView.setMatchQuestions(staticMatchQuestions);
							staticMetricView.setDomainId(metricView.getDomainId());
							staticMetricView.setOriginQuestion(metricView.getOriginQuestion());
							staticMetricView.setOriginCheckResult(metricView.getOriginCheckResult());
							
							Object[] o = abcProgramService.execute(BackendSessionEntrance.derive(sessionId, "hot-exec-" + i), staticMetricView.getFunction(), user.getId(), permission, null, lang, timeoutMinutes, user.getDomainId());;
							JSONArray rows = (JSONArray)o[0];
							MetricViewContent metricViewContent = generateContent(rows, staticMetricView.getName(), staticMetricView, lang);
							metricViewContents.add(metricViewContent);
							
							if (!test) {
								// Generate an instantiated card of this general card
								if (staticFunction.getParameters().size() > 0) {
									staticFunction = functionDao.save(staticFunction);
									staticMetricView.setFunction(staticFunction);
									metricViewDao.save(staticMetricView);
								}
							}
						}
					} catch (SessionCancelledException e) {
						// Cancelled: the remaining cards are no longer processed, and this session's stream ends directly.
						throw e;
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
				}
			}
		}
		return metricViewContents;
	}

	@Override
	public List<MetricViewContent> generateStaticContent(String question, String lang, User user, UserDataPermission permission, int timeoutMinutes) {
		List<MetricViewContent> metricViewContents = new ArrayList<MetricViewContent>();
		List<Object[]> oList = metricViewDao.find(question, MetricView.TYPE_STATIC, null, 10, 0, user.getDomainId());
		List<Function> functions = functionDao.queryList(null, null, user.getDomainId());
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		for (Object[] o : oList) {
			try {
				MetricView metricView = (MetricView)o[0];
				String fId = (String)o[1];
				metricView.setFunction(functionMap.get(fId));
				MetricViewContent metricViewContent = test(metricView, lang, user, permission, timeoutMinutes);
				metricViewContents.add(metricViewContent);
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return metricViewContents;
	}
	
	private MetricViewContent generateContent(JSONArray rows, String question, MetricView metricView, String lang) {
		int maxSize = 100;
		MetricViewContent metricViewContent = new MetricViewContent();
		Function function = metricView.getFunction();
		
		String md = "";
		md += "# " + function.getName() + "\n";
		md += question + "\n";
		Set<String> titles = new HashSet<String>();
		for (int i = 0; i < rows.size() && i < maxSize; i++) {
			JSONObject row = rows.getJSONObject(i);
			Set<String> keys = row.keySet();
			titles.addAll(keys);
		}
		for (String title : titles) {
			md += "| " + title + " ";
		}
		md += "|\n";
		for (int i = 0; i < titles.size(); i++) {
			md += "| --- ";
		}
		md += "|\n";
		for (int i = 0; i < rows.size() && i < maxSize; i++) {
			JSONObject row = rows.getJSONObject(i);
			for (String title : titles) {
				Object value = row.get(title);
				md += "| " + value + " ";
			}
			md += "|\n";
		}
		if (rows.size() > maxSize) {
			for (int i = 0; i < titles.size(); i++) {
				md += "| ... ";
			}
			md += "|\n";
			md += langService.get(lang, "QuestionCard.totalNum") + ": " + rows.size() + ", " + langService.get(lang, "QuestionCard.showNum") + maxSize + ", " + langService.get(lang, "QuestionCard.canGetByUrl") + ".\n";
		}
		metricViewContent.setMd(md);
		
		metricViewContent.setOriginQuestion(metricView.getOriginQuestion());
		metricViewContent.setOriginCheckResult(metricView.getOriginCheckResult());
		
		List<String> parameterInstanceDesc = new ArrayList<String>();
		for (Parameter parameter : function.getParameters()) {
			parameterInstanceDesc.add(langService.get(lang, "QuestionCard.originCondition") + "[" + parameter.getSample() + "], " + langService.get(lang, "QuestionCard.replaceTo") + ": " + parameter.getValue());
		}
		metricViewContent.setParameterInstanceDesc(parameterInstanceDesc);

		JSONObject abcProgram = new JSONObject();
		abcProgram.put("title", function.getName());
		abcProgram.put("code", function.getCode());
		abcProgram.put("outKeyRefs", function.getReturnDef().getOutKeyRefs());
		abcProgram.put("parameters", function.getParameters());

		JSONObject answerPayload = new JSONObject();
		answerPayload.put("answer", rows);
		JSONArray data = new JSONArray();
		data.add(answerPayload);

		JSONObject result = new JSONObject();
		result.put("data", data);
		result.put("abcProgram", abcProgram);
		String shortCode = subQueryWorkspaceDao.writeResult(result);
		metricViewContent.setUrl(dataRagConfig.getCardBaseUrl() + "/metricView/getData?parameter=" + shortCode);
		return metricViewContent;
	}
	
	@Override
	public JSONObject getData(String shortCode, String lang) throws Exception {
		final JSONObject result;
		try {
			result = subQueryWorkspaceDao.readResult(shortCode);
		} catch (Exception e) {
			throw new Exception(langService.get(lang, "MetricView.snapshotUnreadable"), e);
		}
		if (result == null) {
			throw new Exception(langService.get(lang, "MetricView.snapshotNotFound"));
		}
		return result;
	}
	
	@Override
	public JSONArray execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
		MetricView metricView = queryById(id);
		return testExecute(metricView, param, lang, user, permission, timeoutMinutes);
	}
	
	@Override
	public JSONArray testExecute(MetricView metricView, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
		if (metricView != null) {
			if (MetricView.STATUS_PUBLISHED.equals(metricView.getStatus())) {
				Function function = metricView.getFunction();
				if (MetricView.TYPE_GENERAL.equals(metricView.getType())) {
					for (Parameter parameter : function.getParameters()) {
						Object value = param.get(parameter.getName());
						parameter.setValue(value);
					}
				}
				
				Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), function, user.getId(), permission, null, lang, timeoutMinutes, user.getDomainId());
				JSONArray data = (JSONArray)o[0];
				return data;
			} else {
				throw new Exception(langService.get(lang, "MetricView.notPublished"));
			}
		} else {
			throw new Exception(langService.get(lang, "MetricView.notFound"));
		}
	}
	
}
