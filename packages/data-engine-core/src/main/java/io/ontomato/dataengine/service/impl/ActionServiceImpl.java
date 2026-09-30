package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.SandboxService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.tools.ActionSubmitTools;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.ShortCodeGenerator;
import io.ontomato.dataengine.util.UserMessageUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ActionServiceImpl implements ActionService {
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private SandboxService sandboxService;
	
	@Autowired
	private ActionDao actionDao;
	
	@Autowired
	private FunctionDao functionDao;

	@Autowired
	private KnowledgeDao knowledgeDao;
	
	@Autowired
	private ABCProgramService abcProgramService;
	
	@Autowired
	private LangService langService;
	
	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
	@PostConstruct
	public void initService() {
		// Periodically clean up unpublished actions older than 12 hours
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Object[]> oList = actionDao.queryList(Action.STATUS_PENDING_REVIEW, null, null, null);
						for (Object[] o : oList) {
							Action action = (Action)o[0];
							if (!Action.ORIGIN_SYSTEM.equals(action.getOrigin())) {
								if (now - action.getModifyTimestamp() > timeoutTimeRange) {
									actionDao.delete(action.getId());
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
	public Action generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception {
		String sandboxId = "a" + ShortCodeGenerator.gerenate().toLowerCase();
		
		try {
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			
			// Create sandbox environment
			sandboxService.createNamespace(sandboxId, domainId);
			for (Map<String, Object> classDef : classDefs) {
				sandboxService.createClass(sandboxId, classDef, domainId);
			}
			for (String relationName : relationship_rule.keySet()) {
				sandboxService.createEdge(sandboxId, relationName, domainId);
			}
			agentWorkspaceService.createWorkspace(sandboxId);

			// Call the action generator
			BusinessConfig businessConfig = businessConfigService.get(domainId);
			String port = businessConfigService.getRuntimeWholeConfig(domainId).getJSONObject("server").getInteger("port") + "";
			
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sandboxId);
			originalQuestion.setQuestion(question);
			String userMessage = UserMessageUtil.getActionMakerUserMessage(question, port, knowledgeDao, businessConfigService, lang, langService, jsonRule, domainId);
			multiThreadAIChatService.chat(
					MultiThreadAIChatService.ACTION_MAKER,
					originalQuestion,
					sandboxId,
					userMessage,
					ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
					domainId);
			
			// The delivery only comes from the submission registration, and no longer implicitly reads the files left by the last test
			String submitted = agentWorkspaceService.getSubmission(sandboxId);
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
			String code = envelope.getString(ActionSubmitTools.CODE_KEY);
			String name = envelope.getString(ActionSubmitTools.NAME_KEY);
			String logic = envelope.getString(ActionSubmitTools.LOGIC_KEY);
			JSONArray classNamesArray = envelope.getJSONArray(ActionSubmitTools.CLASS_NAMES_KEY);
			if (code == null || name == null || logic == null || classNamesArray == null) {
				return null;
			}
			List<String> classNames = classNamesArray.toList(String.class);
			if (classNames.isEmpty()) {
				return null;
			}
			if (!envelope.containsKey(ActionSubmitTools.PARAMETER_DEFS_KEY)) {
				return null;
			}
			JSONArray defsArray = envelope.getJSONArray(ActionSubmitTools.PARAMETER_DEFS_KEY);
			if (defsArray == null) {
				return null;
			}
			List<Parameter> parameterDefs = DBSchemaUtil.buildParameters(defsArray.toList(Map.class), classDefs);
			Function function = new Function();
			function.setOrigin(Function.ORIGIN_USER);
			function.setOperation(Function.OPERATION_WRITE);
			function.setDomainId(domainId);
			function.setName(name);
			function.setParameters(parameterDefs);
			function.setCode(code);
			function.setLogic(logic);
			
			ReturnDef returnDef = new ReturnDef();
			returnDef.setIsVoid(true);
			returnDef.setClassNames(classNames);
			function.setReturnDef(returnDef);
			if (persistence) {
				function = functionDao.save(function);
			}
			
			Action action = new Action();
			action.setName(function.getName());
			action.setOrigin(Action.ORIGIN_USER);
			action.setFunction(function);
			action.setStatus(Action.STATUS_PUBLISHED);
			action.setDomainId(domainId);
			try {
				Object[] explain = explainCode(function.getParameters(), function.getCode(), action.getDomainId(), lang);
				JSONArray codeSegments = (JSONArray)explain[0];
				BusinessMeaning businessMeaning = (BusinessMeaning)explain[1];
				action.setCodeSegments(codeSegments);
				action.setBusinessMeaning(businessMeaning);
			} catch (Exception e) {}
			if (persistence) {
				action = actionDao.save(action);
			}
			return action;
		} catch (Exception e) {
			throw e;
		} finally {
			// Clean up the sandbox environment and the workspace of this run
			agentWorkspaceService.removeWorkspace(sandboxId);
			sandboxService.truncateNamespace(sandboxId, domainId);
			sandboxService.dropNamespace(sandboxId, domainId);
		}
	}
	
	@Override
	public Action save(Action action, String lang) throws Exception {
		JSONArray storedCodeSegments = null;
		BusinessMeaning storedBusinessMeaning = null;
		if (action.getId() != null) {
			Object[] exist = actionDao.queryById(action.getId());
			if (exist == null) {
				throw new Exception(langService.get(lang, "Action.notFound"));
			} else {
				Action existAction = (Action)exist[0];
				if (Action.ORIGIN_SYSTEM.equals(existAction.getOrigin())) {
					throw new Exception(langService.get(lang, "Action.cannotModifySystem"));
				}
				if (!action.getDomainId().equals(existAction.getDomainId())) {
					throw new Exception(langService.get(lang, "Action.domainMismatch"));
				}
				storedCodeSegments = existAction.getCodeSegments();
				storedBusinessMeaning = existAction.getBusinessMeaning();
			}
		}
		// Code segments and business meaning are derived by the server from the saved code; values carried by the request are not trusted: invalidate them first,
		// restore the values already stored in the database when the code has not changed; re-interpret when the code has changed or the function is new, and keep them empty if the interpretation fails, so that an old interpretation is not paired with new code
		action.setCodeSegments(null);
		action.setBusinessMeaning(null);
		if (action.getFunction() != null) {
			Function function = action.getFunction();
			if (function.getId() != null) {
				Function existFunction = functionDao.queryById(function.getId());
				if (existFunction != null) {
					if (!Function.OPERATION_WRITE.equals(existFunction.getOperation())) {
						throw new Exception(langService.get(lang, "Function.notWrite"));
					}
					if (!existFunction.getCode().equals(function.getCode())) {
						try {
							Object[] explain = explainCode(function.getParameters(), function.getCode(), action.getDomainId(), lang);
							JSONArray codeSegments = (JSONArray)explain[0];
							BusinessMeaning businessMeaning = (BusinessMeaning)explain[1];
							action.setCodeSegments(codeSegments);
							action.setBusinessMeaning(businessMeaning);
						} catch (Exception e) {}
					} else {
						action.setCodeSegments(storedCodeSegments);
						action.setBusinessMeaning(storedBusinessMeaning);
					}
				} else {
					throw new Exception(langService.get(lang, "Function.notFound"));
				}
			} else {
				if (!Function.OPERATION_WRITE.equals(function.getOperation())) {
					throw new Exception(langService.get(lang, "Function.notWrite"));
				}
				try {
					Object[] explain = explainCode(function.getParameters(), function.getCode(), action.getDomainId(), lang);
					JSONArray codeSegments = (JSONArray)explain[0];
					BusinessMeaning businessMeaning = (BusinessMeaning)explain[1];
					action.setCodeSegments(codeSegments);
					action.setBusinessMeaning(businessMeaning);
				} catch (Exception e) {}
			}
			function = functionDao.save(function);
			action.setFunction(function);
		} else {
			throw new Exception(langService.get(lang, "Function.cannotBeEmpty"));
		}
		return actionDao.save(action);
	}

	@Override
	public void delete(String id, String lang) throws Exception {
		Object[] exist = actionDao.queryById(id);
		if (exist != null) {
			Action existAction = (Action)exist[0];
			if (Action.ORIGIN_SYSTEM.equals(existAction.getOrigin())) {
				throw new Exception(langService.get(lang, "Action.cannotDeleteSystem"));
			}
			actionDao.delete(id);
		}
	}

	@Override
	public Action queryById(String id) {
		Object[] o  = actionDao.queryById(id);
		if (o != null) {
			Action action = (Action)o[0];
			String functionId = (String)o[1];
			Function function = functionDao.queryById(functionId);
			action.setFunction(function);
			return action;
		} else {
			return null;
		}
	}

	@Override
	public List<Action> queryList(String status, String functionId, String className, String domainId) {
		List<Object[]> oList = actionDao.queryList(status, functionId, className, domainId);
		List<Function> functions = functionDao.queryList(null, null, null);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<Action> actions = new ArrayList<Action>();
		for (Object[] o : oList) {
			Action action = (Action)o[0];
			String fId = (String)o[1];
			action.setFunction(functionMap.get(fId));
			actions.add(action);
		}
		return actions;
	}

	@Override
	public List<Action> find(String question, String className, String domainId) {
		List<Object[]> oList = actionDao.find(question, className, 10, 0, domainId);
		List<Function> functions = functionDao.queryList(null, null, domainId);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<Action> actions = new ArrayList<Action>();
		for (Object[] o : oList) {
			Action action = (Action)o[0];
			String functionId = (String)o[1];
			action.setFunction(functionMap.get(functionId));
			actions.add(action);
		}
		return actions;
	}

	@Override
	public PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
		Action action = queryById(id);
		if (action != null) {
			if (Action.STATUS_PUBLISHED.equals(action.getStatus())) {
				Function function = action.getFunction();
				for (Parameter parameter : function.getParameters()) {
					Object value = param.get(parameter.getName());
					parameter.setValue(value);
				}
				Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), function, user.getId(), permission, ServiceConst.NOT_SANDBOX, lang, timeoutMinutes, user.getDomainId());
				PythonExecuteResult result = (PythonExecuteResult)o[1];
				return result;
			} else {
				throw new Exception(langService.get(lang, "Action.notPublished"));
			}
		} else {
			throw new Exception(langService.get(lang, "Action.notFound"));
		}
	}
	
	private Object[] explainCode(List<Parameter> parameters, String code, String domainId, String lang) throws Exception {
		String sessionId = UUID.randomUUID().toString();
		File codeFile = null;
		FileOutputStream fos = null;
		try {
			codeFile = new File(new File(ServiceConst.CODE_EXPLAIN_BASE), sessionId + ".py");
			codeFile.getParentFile().mkdirs();
			fos = new FileOutputStream(codeFile);
			fos.write(code.getBytes("utf-8"));
			
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
			// Passing null for classNames means using all object classes in jsonRule
			String userMessage = UserMessageUtil.getActionCodeExplainerUserMessage(parameters, jsonRule, lang, langService);
			
			BusinessConfig businessConfig = businessConfigService.get(domainId);
			
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sessionId);
			originalQuestion.setQuestion("");
			
			String retStr = multiThreadAIChatService.chat(
					MultiThreadAIChatService.ACTION_CODE_EXPLAINER,
					originalQuestion,
					sessionId,
					userMessage,
					ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
					domainId);
			
			// Strip the ```json wrapper
			if (retStr != null && retStr.indexOf("```json") >= 0) {
				retStr = retStr.substring(retStr.indexOf("```json") + 7);
			}
			if (retStr != null && retStr.lastIndexOf("```") > 0) {
				retStr = retStr.substring(0, retStr.lastIndexOf("```"));
			}
			
			// The model output enters the system here: anything with an invalid shape is discarded as a whole, and after throwing it is handled by the caller as an interpretation failure
			JSONObject result = retStr == null ? null : JSONObject.parseObject(retStr.trim());
			JSONArray segs = ActionCodeExplanationValidator.segments(result);
			BusinessMeaning businessMeaning = ActionCodeExplanationValidator.businessMeaning(result);
			return new Object[] {segs, businessMeaning};
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception(langService.get(lang, "Action.parseCodeExplainFailed") + ": " + e.getMessage());
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
			if (codeFile != null && codeFile.exists()) {
				codeFile.delete();
			}
		}
	}

}
