package io.ontomato.dataengine.tools;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTask;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTaskMessage;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.ABCHarnessTaskService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.DslRuleUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("abcProgrammerSkillTools")
public class ABCProgrammerSkillTools {

	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private ABCHarnessTaskService abcHarnessTaskService;
	
	@Autowired
	private PythonExecuteService pythonExecuteService;
	
	@Autowired
	private ABCProgramService abcProgramService;

	@Autowired
	private AgentWorkspaceService workspaceService;

	@Tool("Execute the Python file in this workspace to verify the inline DSL and calculation logic\n" +
            "Input: Python file relative path; the full code text is not accepted\n" +
            "Output: print output and/or runtime error ")
    public String test(@P("Python file relative path") String path) {
		String lang = "en";
		int maxContentSize = 2000;
		String ret = "";
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String sessionId = callContext.getSessionId();
			Path file = workspaceService.resolve(sessionId, path);
			workspaceService.clearExecution(sessionId, file.toString());
			if (!file.toString().endsWith(".py") || !Files.isRegularFile(file)) {
				throw new IllegalArgumentException("The execution entry point must be an existing Python file in the workspace");
			}
			String code = Files.readString(file);
			if (code.isBlank()) {
				throw new Exception("python program code must not be empty");
			}
			
			// Execute the code
			BusinessConfig businessConfig = businessConfigService.get(callContext.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult pythonExecuteResult = pythonExecuteService.runPythonFile(sessionId, file.toFile(), timeoutMinutes, lang, "admin", callContext.getDomainId());
			if (!code.equals(Files.readString(file))) throw new IllegalStateException("The program file changed during execution, please test again");
			String content = pythonExecuteResult.getResult();
			String error = pythonExecuteResult.getError();
			workspaceService.saveExecution(sessionId, file.toString(), new AgentWorkspaceService.FileExecution(code, error, pythonExecuteResult));
			String result = null;
			if (content != null) {
				result = "";
				if (content.length() > maxContentSize) {
					content = content.substring(0, maxContentSize) + " ...\n(print output exceeds " + maxContentSize + " characters, the rest is omitted here; after this Python code is formally output, the complete content will be output according to the program logic)";
				}
				result += "python print output:\n```\n" + content + "\n```\n";
				
			}
			if (error != null) {
				if (result == null) {
					result = "";
				}
				result += (content != null ? "Also " : "") + "python error stream:\n```\n" + error + "\n```\n";
			}
			if (result != null) {
				ret = result;
			} else {
				ret = "Execution print output is empty";
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret = "Execution error: " + e.getMessage();
		}
		return ret;
	}
	
	@Tool("Formal output of the sub-question\n" +
            "Input:  sub-question, the attribute sources of the content printed by the Python program, the relative path of the finally delivered Python file\n" +
            "Output: whether it was saved successfully or an exception ")
    public String outputCode(@P("sub-question") String question, @P("the attribute sources of the content printed by the Python program") List<Map> outKeyRefs, @P("the relative path of the finally delivered Python file") String path) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String sessionId = callContext.getSessionId();
			//Get the task
			ABCHarnessTask task = abcHarnessTaskService.getTaskBySessionId(sessionId);
			
			if (task != null) {
				Path file = workspaceService.resolve(sessionId, path);
				AgentWorkspaceService.FileExecution tested = workspaceService.getExecution(sessionId, file.toString());
				if (tested == null) {
					throw new Exception("The Python code of this file has not been tested, please test it before formal output");
				}
				if (tested.error() != null && !tested.error().isBlank()) {
					throw new IllegalStateException("The last program test reported an error, please fix it and test again");
				}
				String pythonCode = tested.content();
				if (!pythonCode.equals(Files.readString(file))) {
					throw new IllegalStateException("The program file has been modified, please test again before formal output");
				}
				// Build the attribute sources
				int timeoutMinutes = task.getTimeoutMinutes();
				String lang = task.getLang();
				String userId = task.getUserId();
				UserDataPermission curUserDataPermission = task.getCurUserDataPermission();
				ABCHarnessProgram program = new ABCHarnessProgram();
				program.setQuestion(question.trim());
				program.setCode(pythonCode);
				Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
				List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
				try {
					List<ABCHarnessProgramOutKeyRef> okrs = new ArrayList<ABCHarnessProgramOutKeyRef>();
					for (int i = 0; i < outKeyRefs.size(); i++) {
						okrs.add(applyOutKeyRef(outKeyRefs.get(i), i, classDefs));
					}
					program.setOutKeyRefs(okrs);
				} catch (Exception e) {
					log.error(e.getMessage(), e);
					throw new Exception("Error in the output attribute sources: " + e.getMessage());
				}
				
				Map<String, Set<String>> classAttrMap = new HashMap<String, Set<String>>();
				for (Map<String, Object> classDef : classDefs) {
					List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
					Set<String> attrs = new HashSet<String>();
					for (Map<String, Object> attrDef : attrDefs) {
						if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
							attrs.add((String)attrDef.get("name"));
						}
					}
					classAttrMap.put((String)classDef.get("className"), attrs);
				}
				for (ABCHarnessProgramOutKeyRef okr : program.getOutKeyRefs()) {
					if (classAttrMap.get(okr.getClassName()) == null) {
						throw new Exception("The attribute sources you output do not contain the class name `" + okr.getClassName() + "`");
					} else {
						Set<String> attrs = classAttrMap.get(okr.getClassName());
						if (!attrs.contains(okr.getAttrName())) {
							throw new Exception("In the attribute sources you output, the `" + okr.getClassName() + "` class does not contain the `" + okr.getAttrName() + "` attribute");
						}
					}
				}
				
				// If the current user's row permission is full-data permission, take the return result directly from the last test result; otherwise execute the code again under that user's permission to get the return result
				boolean samePermission = true;
				for (ABCHarnessProgramOutKeyRef okr : program.getOutKeyRefs()) {
					if (okr.getClassName() != null && !"".equals(okr.getClassName().trim())) {
						JSONObject rowPermission = curUserDataPermission.getRowPermissionMQLByClassName(okr.getClassName().trim());
						if (rowPermission != null) {
							samePermission = false;
						}
					}
				}
				PythonExecuteResult execution = samePermission ? tested.pythonResult()
						: pythonExecuteService.runPythonFile(sessionId, file.toFile(), timeoutMinutes, lang, userId, callContext.getDomainId());
				if (!pythonCode.equals(Files.readString(file))) throw new IllegalStateException("The program file changed during execution, please test again");
				JSONArray answer = abcProgramService.dealPythonReturn(execution.getResult(), execution.getError(), program.getOutKeyRefs(), curUserDataPermission);
	            
				JSONObject retMessage = new JSONObject();
				retMessage.put("question", program.getQuestion());
				retMessage.put("data", answer);
				retMessage.put("code", program.getCode());
				retMessage.put("outKeyRefs", program.getOutKeyRefs());
				
				ABCHarnessTaskMessage message = new ABCHarnessTaskMessage();
				message.setSessionId(sessionId);
				message.setType(ABCHarnessTaskMessage.DATA_TYPE);
				message.setContent(retMessage);
				abcHarnessTaskService.pushMessage(message);
				return "Output succeeded";
			} else {
				return "This task has ended, there is no need to continue outputting.";
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Output failed: " + e.getMessage();
		}
	}
	
	@Tool("Output the reasoning process\n" +
            "Input:  reasoning process\n")
    public void outputMessage(@P("reasoning process") String content) {
		try {
			String sessionId = AgentCallContext.current().getSessionId();
			ABCHarnessTaskMessage message = new ABCHarnessTaskMessage();
			message.setSessionId(sessionId);
			message.setType(ABCHarnessTaskMessage.MESSAGE_TYPE);
			JSONObject retMessage = new JSONObject();
			retMessage.put("content", content.trim());
			message.setContent(retMessage);
			abcHarnessTaskService.pushMessage(message);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	/**
	 * Build the sub-query shape the DSL rule/example builders expect, from the class names the
	 * programmer is about to use. All C-step features are requested; the attribute types of the
	 * named classes decide which condition rules (text/vector/timeseries) are actually included.
	 */
	/** Map one model-supplied output key reference onto a typed {@link ABCHarnessProgramOutKeyRef}. */
	static ABCHarnessProgramOutKeyRef applyOutKeyRef(Map colRef, int index, List<Map<String, Object>> classDefs) {
		ABCHarnessProgramOutKeyRef okr = new ABCHarnessProgramOutKeyRef();
		okr.setKey((String) colRef.get("key"));
		okr.setClassName(DBSchemaUtil.normalizeClassName((String) colRef.get("className"), classDefs));
		okr.setAttrName((String) colRef.get("attrName"));
		okr.setAsGroupBy(asBoolean(colRef.get("asGroupBy"), "asGroupBy", index));
		okr.setStatCal(asBoolean(colRef.get("statCal"), "statCal", index));
		return okr;
	}

	/**
	 * Read a flag from the model's output strictly enough to catch a real typo, but tolerantly enough to
	 * accept the string and number forms a model emits ("true", "1"). A value that is neither a boolean
	 * nor one of those forms fails with the exact {@code outputKeyRefs[i].<key>} named, instead of a bare
	 * cast error that does not say which field was wrong.
	 */
	static boolean asBoolean(Object value, String key, int index) {
		if (value == null) {
			return false;
		}
		if (value instanceof Boolean b) {
			return b;
		}
		if (value instanceof Number n) {
			return n.doubleValue() != 0d;
		}
		String s = String.valueOf(value).trim();
		if ("true".equalsIgnoreCase(s) || "1".equals(s) || "yes".equalsIgnoreCase(s)) {
			return true;
		}
		if (s.isEmpty() || "false".equalsIgnoreCase(s) || "0".equals(s) || "no".equalsIgnoreCase(s)) {
			return false;
		}
		throw new IllegalArgumentException("outputKeyRefs[" + index + "]." + key
				+ " must be a boolean (true/false), but was \"" + s + "\"");
	}

	private static JSONObject dslScope(List<String> classNames) {
		JSONObject subQuery = new JSONObject();
		JSONArray classes = new JSONArray();
		if (classNames != null) {
			for (String className : classNames) {
				if (className != null && !className.trim().isEmpty()) {
					classes.add(className.trim());
				}
			}
		}
		subQuery.put("classes", classes);
		subQuery.put("DSL_relationship", true);
		subQuery.put("DSL_C_Step_group_by", true);
		subQuery.put("DSL_C_Step_function", true);
		subQuery.put("DSL_C_Step_four_basic_math", true);
		subQuery.put("DSL_C_Step_sort", true);
		subQuery.put("C_Step", "on demand");
		return subQuery;
	}

	@Tool("Get the Ontology DSL syntax rules that apply to the object classes you are about to use. "
			+ "Call this before writing DSL; do not rely on memory for the rule text.\n"
			+ "Input: object class name array\n"
			+ "Output: the DSL rule text for those classes' attribute types")
	public String getDslSyntax(@P("object class name array") List<String> classNames) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
			return DslRuleUtil.generateDslRule(dslScope(classNames), jsonRule);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get the DSL syntax rules: " + e.getMessage();
		}
	}

	@Tool("Get a complete Ontology DSL syntax example scoped to the object classes you are about to use. "
			+ "Call this when you need a full worked example; do not rely on memory for the example.\n"
			+ "Input: object class name array\n"
			+ "Output: a DSL example using only the constructs available for those classes")
	public String getDslExample(@P("object class name array") List<String> classNames) {
		try {
			AgentCallContext callContext = AgentCallContext.current();
			Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
			return DslRuleUtil.generateDslExample(dslScope(classNames), jsonRule);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get the DSL example: " + e.getMessage();
		}
	}
	
}
