package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.WriteTaskDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.tools.ReadFunctionSubmitTools;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.DslToPythonCodeUtil;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.UserMessageUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class FunctionServiceImpl implements FunctionService {
	
	@Autowired
    private AdminService adminService;

	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
    private LangService langService;
	
	@Autowired
	private FunctionDao functionDao;
	
	@Autowired
	private MetricViewDao metricViewDao;
	
	@Autowired
	private ActionDao actionDao;
	
	@Autowired
	private WriteTaskDao writeTaskDao;
	
	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
    private Pattern NAME_PATTERN = Pattern.compile("<name>([\\s\\S]+?)</name>" );
    
    @PostConstruct
	public void initService() {
    	// Periodically clean up unreferenced read functions from 12 hours ago
    	new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Function> functions = functionDao.queryList(Function.OPERATION_READ, null, null);
						List<Object[]> oList = metricViewDao.queryList(null, null, null, null, null);
						Set<String> functionIds = new HashSet<String>();
						for (Object[] o : oList) {
							String functionId = (String)o[1];
							functionIds.add(functionId);
						}
						for (Function function : functions) {
							if (!Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
								if (!functionIds.contains(function.getId())) {
									if (now - function.getModifyTimestamp() > timeoutTimeRange) {
										functionDao.delete(function.getId());
									}
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
    	// Periodically clean up unreferenced write functions from 12 hours ago
    	new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Function> functions = functionDao.queryList(Function.OPERATION_WRITE, null, null);
						Set<String> functionIds = new HashSet<String>();
						for (Object[] o : actionDao.queryList(null, null, null, null)) {
							String functionId = (String)o[1];
							functionIds.add(functionId);
						}
						for (Object[] o : writeTaskDao.queryList(null, null, null, null)) {
							String functionId = (String)o[1];
							functionIds.add(functionId);
						}
						for (Function function : functions) {
							if (!Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
								if (!functionIds.contains(function.getId())) {
									if (now - function.getModifyTimestamp() > timeoutTimeRange) {
										functionDao.delete(function.getId());
									}
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
	public Function generateFromDsl(String question, JSONObject dsl, String lang, String domainId, String sessionId) {
		Function function = new Function();
		function.setOrigin(Function.ORIGIN_USER);
		function.setOperation(Function.OPERATION_READ);
		function.setDomainId(domainId);
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String port = businessConfigService.getRuntimeWholeConfig(domainId).getJSONObject("server").getInteger("port") + "";
		String originCode = DslToPythonCodeUtil.generate(dsl, port);
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(sessionId);
		originalQuestion.setQuestion(question);
		String userMessage = UserMessageUtil.getReadFunctionMakerUserMessage(question, originCode, lang, langService, jsonRule);
		try {
			agentWorkspaceService.createWorkspace(sessionId);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		try {
		multiThreadAIChatService.chat(
				MultiThreadAIChatService.READ_FUNCTION_MAKER,
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
		String code = envelope.getString(ReadFunctionSubmitTools.CODE_KEY);
		String name = envelope.getString(ReadFunctionSubmitTools.NAME_KEY);
		String logic = envelope.getString(ReadFunctionSubmitTools.LOGIC_KEY);
		if (code == null || name == null || logic == null) {
			return null;
		}
		List<Parameter> parameters = new ArrayList<Parameter>();
		if (envelope.containsKey(ReadFunctionSubmitTools.PARAMETER_DEFS_KEY)) {
			parameters = DBSchemaUtil.buildParameters(envelope.getJSONArray(ReadFunctionSubmitTools.PARAMETER_DEFS_KEY).toList(Map.class), classDefs);
		}
		function.setName(name);
		function.setParameters(parameters);
		function.setCode(code);
		function.setLogic(logic);
		
		ReturnDef returnDef = new ReturnDef();
		returnDef.setIsVoid(false);
		List<ABCHarnessProgramOutKeyRef> outKeyRefs = new ArrayList<ABCHarnessProgramOutKeyRef>();
		List<String> classNames = new ArrayList<String>();
		Map<String, DslConsanguinity> consanguinityMap = DslUtil.findConsanguinityFromDsl(dsl, classDefs);
		for (String key : consanguinityMap.keySet()) {
			DslConsanguinity consanguinity = consanguinityMap.get(key);
			ABCHarnessProgramOutKeyRef outKeyRef = new ABCHarnessProgramOutKeyRef();
			outKeyRef.setKey(key);
			outKeyRef.setClassName(consanguinity.getClassName());
			outKeyRef.setAttrName(consanguinity.getAttrName());
			outKeyRef.setAsGroupBy(consanguinity.getAsGroupBy());
			outKeyRef.setStatCal(consanguinity.getFunction() != null && !"".equals(consanguinity.getFunction().trim()));
			outKeyRefs.add(outKeyRef);
			if (!classNames.contains(consanguinity.getClassName())) {
				classNames.add(consanguinity.getClassName());
			}
		}
		returnDef.setOutKeyRefs(outKeyRefs);
		returnDef.setClassNames(classNames);
		function.setReturnDef(returnDef);
		
		return function;
		} finally {
			agentWorkspaceService.removeWorkspace(sessionId);
		}
	}
	
	@Override
	public Function generateFromABCProgram(String question, ABCHarnessProgram abcProgram, String lang, String domainId, String sessionId) {
		Function function = new Function();
		function.setOrigin(Function.ORIGIN_USER);
		function.setOperation(Function.OPERATION_READ);
		function.setDomainId(domainId);
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String originCode = abcProgram.getCode();
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(sessionId);
		originalQuestion.setQuestion(question);
		String userMessage = UserMessageUtil.getReadFunctionMakerUserMessage(question, originCode, lang, langService, jsonRule);
		try {
			agentWorkspaceService.createWorkspace(sessionId);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		try {
		multiThreadAIChatService.chat(
				MultiThreadAIChatService.READ_FUNCTION_MAKER,
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
		String code = envelope.getString(ReadFunctionSubmitTools.CODE_KEY);
		String name = envelope.getString(ReadFunctionSubmitTools.NAME_KEY);
		String logic = envelope.getString(ReadFunctionSubmitTools.LOGIC_KEY);
		if (code == null || name == null || logic == null) {
			return null;
		}
		List<Parameter> parameters = new ArrayList<Parameter>();
		if (envelope.containsKey(ReadFunctionSubmitTools.PARAMETER_DEFS_KEY)) {
			parameters = DBSchemaUtil.buildParameters(envelope.getJSONArray(ReadFunctionSubmitTools.PARAMETER_DEFS_KEY).toList(Map.class), classDefs);
		}
		function.setName(name);
		function.setParameters(parameters);
		function.setCode(code);
		function.setLogic(logic);
		
		ReturnDef returnDef = new ReturnDef();
		returnDef.setIsVoid(false);
		List<ABCHarnessProgramOutKeyRef> outKeyRefs = abcProgram.getOutKeyRefs();
		List<String> classNames = new ArrayList<String>();
		for (ABCHarnessProgramOutKeyRef outKeyRef : outKeyRefs) {
			if (!classNames.contains(outKeyRef.getClassName())) {
				classNames.add(outKeyRef.getClassName());
			}
		}
		returnDef.setOutKeyRefs(outKeyRefs);
		returnDef.setClassNames(classNames);
		function.setReturnDef(returnDef);
		
		return function;
		} finally {
			agentWorkspaceService.removeWorkspace(sessionId);
		}
	}
	
	@Override
	public Function generateStaticFromGeneral(String question, List<Parameter> parameters, Function generalFunction, String lang, String sessionId) {
		if (generalFunction.getParameters().size() > 0) {
			Function staticFunction = new Function();
			staticFunction.setOrigin(Function.ORIGIN_USER);
			staticFunction.setOperation(Function.OPERATION_READ);
			staticFunction.setParameters(parameters);
			staticFunction.setReturnDef(generalFunction.getReturnDef());
			staticFunction.setCode(generalFunction.getCode());
			staticFunction.setLogic(generalFunction.getLogic());
			staticFunction.setDomainId(generalFunction.getDomainId());
			
			BusinessConfig businessConfig = businessConfigService.get(generalFunction.getDomainId());
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sessionId);
			originalQuestion.setQuestion(question);
			String userMessage = UserMessageUtil.getStaticReadFunctionNameMakerUserMessage(generalFunction, parameters, lang, langService);
			String retStr = multiThreadAIChatService.chat(
					MultiThreadAIChatService.STATIC_READ_FUNCTION_NAME_MAKER,
					originalQuestion,
					sessionId,
					userMessage,
					ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
					generalFunction.getDomainId());
			Matcher nameMatcher = NAME_PATTERN.matcher(retStr);
        	if (nameMatcher.find()) {
        		String name = nameMatcher.group(1);
        		staticFunction.setName(name);
        		return staticFunction;
        	}
		}
		
		return null;
	}
	
	@Override
	public Function save(Function function, String lang) throws Exception {
		if (function.getId() != null) {
			Function existFunction = functionDao.queryById(function.getId());
			if (existFunction == null) {
				throw new Exception(langService.get(lang, "Function.notFound"));
			} else {
				if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
					throw new Exception(langService.get(lang, "Function.cannotModifySystem"));
				}
				if (!function.getDomainId().equals(existFunction.getDomainId())) {
					throw new Exception(langService.get(lang, "Function.domainMismatch"));
				}
			}
			// A referenced Function cannot be modified or deleted
			isReferenced(function.getId(), lang);
		}
		return functionDao.save(function);
	}
	
	private void isReferenced(String functionId, String lang) throws Exception {
		// A Function referenced by a MetricView cannot be modified or deleted
		if (metricViewDao.queryList(null, null, functionId, null, null).size() > 0) {
			throw new Exception(langService.get(lang, "Function.referencedByMetricView"));
		}
		// A Function referenced by an Action cannot be modified or deleted
		if (actionDao.queryList(null, functionId, null, null).size() > 0) {
			throw new Exception(langService.get(lang, "Function.referencedByAction"));
		}
		// A Function referenced by a WriteTask cannot be modified or deleted
		if (writeTaskDao.queryList(null, functionId, null, null).size() > 0) {
			throw new Exception(langService.get(lang, "Function.referencedByWriteTask"));
		}
	}
	
	@Override
	public void delete(String id, String lang) throws Exception {
		Function function = functionDao.queryById(id);
		if (function != null) {
			if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
				throw new Exception(langService.get(lang, "Function.cannotDeleteSystem"));
			}
			// A referenced Function cannot be modified or deleted
			isReferenced(function.getId(), lang);
			functionDao.delete(id);
		}
	}
	
	@Override
	public Function queryById(String id) {
		return functionDao.queryById(id);
	}
	
	@Override
	public List<Function> queryList(String operation, String className, String domainId) {
		return functionDao.queryList(operation, className, domainId);
	}

}
