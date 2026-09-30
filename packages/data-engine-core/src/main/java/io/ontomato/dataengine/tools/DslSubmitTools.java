package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

@Component
public class DslSubmitTools {

	@Autowired
	private AgentWorkspaceService workspaceService;

	@Tool("Submit the final DSL file in this workspace as this delivery; only register, do not execute it again. "
			+ "The file must have been successfully executed with executeDslFile, and its content must not have been modified after execution; if submitted multiple times, the last one prevails. "
			+ "The body only writes a brief description, and no longer outputs the full DSL text.")
	public String submitDsl(@P("Relative path of the DSL JSON file successfully executed in this workspace") String path) throws Exception {
		String sessionId = AgentCallContext.current().getSessionId();
		Path file = workspaceService.resolve(sessionId, path);
		if (!file.toString().endsWith(".json") || !Files.isRegularFile(file)) {
			throw new IllegalArgumentException("The submission entry must be an existing JSON file in the workspace");
		}
		AgentWorkspaceService.FileExecution executed = workspaceService.getExecution(sessionId, file.toString());
		if (executed == null) {
			return "Submission failed: the DSL of this file has not been executed, please execute it with executeDslFile first before submitting";
		}
		if (executed.error() != null && !executed.error().isBlank()) {
			return "Submission failed: the last DSL execution of this file reported an error, please fix it and execute again before submitting";
		}
		String content = Files.readString(file);
		if (!executed.content().equals(content)) {
			return "Submission failed: this file was modified again after execution, please execute again before submitting";
		}
		workspaceService.saveSubmission(sessionId, content);
		return "Submitted successfully";
	}

}
