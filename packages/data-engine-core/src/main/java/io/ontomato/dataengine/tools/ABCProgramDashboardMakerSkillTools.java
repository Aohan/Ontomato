package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.util.DBSchemaUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("abcProgramDashboardMakerSkillTools")
public class ABCProgramDashboardMakerSkillTools {

	@Autowired
	private JSONRuleDao jsonRuleDao;

	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private PythonExecuteService pythonExecuteService;

	@Autowired
	private AgentWorkspaceService workspaceService;
	
	@Tool("Run the python program to get the print output and/or runtime error\n" +
            "Input:  whether the code to run is code after parameter extraction, Python file relative path, list of parameter definition objects\n" +
            "Output: print output and/or runtime error ")
    public String test(@P("whether the code to run is code after parameter extraction") Boolean isNewCode, @P("Python file relative path") String path,
    		@P(value = "list of parameter definition objects, each containing key, name, type, value, className, attrName; must have a value when isNewCode=true", required = false) List<Map> parameterDefs) {
		String lang = "en";
		int maxContentSize = 2000;
		String ret = "";
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String sessionId = callContext.getSessionId();
			Path file = workspaceService.resolve(sessionId, path);
			workspaceService.clearExecution(sessionId, file.toString());
			if (!file.toString().endsWith(".py") || !Files.isRegularFile(file)) {
				throw new IllegalArgumentException("The execution entry must be an existing Python file in the workspace");
			}
			String code = Files.readString(file);
			if (code.isBlank()) {
				throw new Exception("python program code must not be empty");
			}
			BusinessConfig businessConfig = businessConfigService.get(callContext.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult pythonExecuteResult = null;
			if (Boolean.TRUE.equals(isNewCode)) {
				if (parameterDefs == null) {
					throw new IllegalArgumentException("Parameter definitions must be provided when isNewCode=true");
				}
				List<ABCHarnessDashboardParameter> parameterDefList =
						JSONArray.parseArray(JSON.toJSONString(parameterDefs), ABCHarnessDashboardParameter.class);
				List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRuleDao.query(callContext.getDomainId()).get("classDef");
				JSONObject parameters = new JSONObject();
				for (ABCHarnessDashboardParameter parameter : parameterDefList) {
					parameter.setClassName(DBSchemaUtil.normalizeClassName(parameter.getClassName(), classDefs));
					parameters.put(parameter.getKey(), parameter.getValue());
				}
				Path parameterFile = file.resolveSibling(file.getFileName() + ".params.json");
				Files.writeString(parameterFile, JSON.toJSONString(parameters, Feature.WriteMapNullValue));
				pythonExecuteResult = pythonExecuteService.runPythonCode(UUID.randomUUID().toString(), code, timeoutMinutes, lang, "admin", callContext.getDomainId(), parameterFile.toAbsolutePath().toString());
			} else {
				pythonExecuteResult = pythonExecuteService.runPythonCode(UUID.randomUUID().toString(), code, timeoutMinutes, lang, "admin", callContext.getDomainId());
			}
			if (!code.equals(Files.readString(file))) throw new IllegalStateException("The program file changed during execution, please test again");
			String content = pythonExecuteResult.getResult();
			String error = pythonExecuteResult.getError();
			workspaceService.saveExecution(sessionId, file.toString(), new AgentWorkspaceService.FileExecution(code, error, pythonExecuteResult));
			String result = null;
			if (content != null) {
				result = "";
				if (content.length() > maxContentSize) {
					content = content.substring(0, maxContentSize) + " ...\n(print output exceeds " + maxContentSize + " characters, the following content is omitted here; this Python code execution will output the complete content according to the program logic)";
				}
				result += "python print output:\n```\n" + content + "\n```\n";
				
			}
			if (error != null) {
				if (result == null) {
					result = "";
				}
				result += (content != null ? "Also, " : "") + "python error:\n```\n" + error + "\n```\n";
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
	
}
