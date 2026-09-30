package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.PythonExecuteService;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("afterCalculatorSkillTools")
public class AfterCalculatorSkillTools {

	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private PythonExecuteService pythonExecuteService;

	@Autowired
	private AgentWorkspaceService workspaceService;
	
	@Tool("Execute the Python file in this workspace to verify the calculation logic\n" +
            "Input: relative path of the Python file; does not accept the full code text\n" +
            "Output: print output and/or runtime error ")
    public String test(@P("Relative path of the Python file") String path) {
		String lang = "en";
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
				throw new Exception("python program code cannot be empty");
			}
			BusinessConfig businessConfig = businessConfigService.get(callContext.getDomainId());
			int timeout = businessConfig.getReportCardPythonTimeout();
			PythonExecuteResult pythonExecuteResult = pythonExecuteService.runPythonCode(BackendSessionEntrance.derive(sessionId, "tool-exec"), code, timeout, lang);
			if (!code.equals(Files.readString(file))) throw new IllegalStateException("The program file changed during execution, please test again");
			String content = pythonExecuteResult.getResult();
			String error = pythonExecuteResult.getError();
			workspaceService.saveExecution(sessionId, file.toString(), new AgentWorkspaceService.FileExecution(code, error, pythonExecuteResult));
			String result = null;
			if (content != null) {
				result = "";
				result += "python print output:\n```\n" + content + "\n```\n";
			}
			if (error != null) {
				if (result == null) {
					result = "";
				}
				result += (content != null ? "Meanwhile, " : "") + "python error:\n```\n" + error + "\n```\n";
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
