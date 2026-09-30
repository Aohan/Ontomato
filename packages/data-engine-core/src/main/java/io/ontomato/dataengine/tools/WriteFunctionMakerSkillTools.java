package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Parameter;
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
@Component("writeFunctionMakerSkillTools")
public class WriteFunctionMakerSkillTools {
	
	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private PythonExecuteService pythonExecuteService;

	@Autowired
	private AgentWorkspaceService workspaceService;
	
	@Tool("Test-run the python program to get the print output and/or runtime error\n" +
            "Input:  Python file relative path, list of parameter definition objects\n" +
            "Output: print output and/or runtime error ")
    public String test(@P("Python file relative path") String path,
    		@P("list of parameter definition objects, each containing name, type, description, value, className") List<Map> parameterDefs) {
		String lang = "en";
		int maxContentSize = 2000;
		String ret = "";
		try {
			AgentCallContext callContext = AgentCallContext.current();
			String sandboxId = callContext.getSessionId();
			String domainId = callContext.getDomainId();
			Path file = workspaceService.resolve(sandboxId, path);
			workspaceService.clearExecution(sandboxId, file.toString());
			if (!file.toString().endsWith(".py") || !Files.isRegularFile(file)) {
				throw new IllegalArgumentException("The execution entry must be an existing Python file in the workspace");
			}
			String code = Files.readString(file);
			if (code == null || "".equals(code.trim())) {
				throw new Exception("python program code must not be empty");
			}
			if (parameterDefs == null) {
				throw new Exception("Failed to parse parameter definitions");
			}
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRuleDao.query(domainId).get("classDef");
			List<Parameter> parameterDefList = DBSchemaUtil.buildParameters(parameterDefs, classDefs);
			JSONObject parameters = new JSONObject();
			for (Parameter parameterDef : parameterDefList) {
				Object value = parameterDef.getValue();
				if (Parameter.TYPE_VECTOR.equals(parameterDef.getType()) && value != null) {
					JSONObject vectorValue = value instanceof JSONObject ? (JSONObject) value : JSONObject.parseObject(JSON.toJSONString(value));
					String text = vectorValue.getString("text");
					if (text != null && !"".equals(text.trim())) {
						Path uploaded = saveVectorText(sandboxId, text);
						vectorValue.put("uploadFilePath", uploaded.toAbsolutePath().toString());
					}
					parameters.put(parameterDef.getName(), vectorValue);
				} else {
					parameters.put(parameterDef.getName(), value);
				}
			}
			Path parameterFile = file.resolveSibling(file.getFileName() + ".params.json");
			Files.writeString(parameterFile, JSON.toJSONString(parameters, Feature.WriteMapNullValue));
			
			// Execute the code
			BusinessConfig businessConfig = businessConfigService.get(domainId);
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult pythonExecuteResult = pythonExecuteService.runPythonCode(UUID.randomUUID().toString(), code, timeoutMinutes, lang, sandboxId, domainId, parameterFile.toAbsolutePath().toString());
			if (!code.equals(Files.readString(file))) throw new IllegalStateException("The program file changed during execution, please test again");
			String content = pythonExecuteResult.getResult();
			String error = pythonExecuteResult.getError();
			workspaceService.saveExecution(sandboxId, file.toString(), new AgentWorkspaceService.FileExecution(code, error, pythonExecuteResult));
			
			String result = null;
			if (content != null) {
				result = "";
				if (content.length() > maxContentSize) {
					content = content.substring(0, maxContentSize) + " ...\n(print output exceeds " + maxContentSize + " characters, the following content is omitted here)";
				}
				result += "python print output:\n```\n" + content + "\n```\n";
				
			}
			if (error != null) {
				if (result == null) {
					result = "";
				}
				result += (content != null ? "Also, " : "") + "python error stream:\n```\n" + error + "\n```\n";
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
	
	/** Write a vector parameter's text into the workspace as a pending upload file and return its absolute path. */
	private Path saveVectorText(String sandboxId, String text) throws Exception {
		Path root = workspaceService.workspaceRoot(sandboxId);
		Files.createDirectories(root);
		Path file = root.resolve("vector_" + UUID.randomUUID().toString() + ".txt");
		Files.writeString(file, text);
		return file;
	}
	
}
