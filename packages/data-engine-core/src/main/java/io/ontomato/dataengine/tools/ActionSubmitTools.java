package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.AgentWorkspaceService;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

@Component
public class ActionSubmitTools {

	public static final String CODE_KEY = "code";
	public static final String PARAMETER_DEFS_KEY = "parameterDefs";
	public static final String CLASS_NAMES_KEY = "classNames";
	public static final String NAME_KEY = "name";
	public static final String LOGIC_KEY = "logic";

	@Autowired
	private AgentWorkspaceService workspaceService;

	@Tool("Submit the final write function Python file in this workspace as this delivery for Action; only register, do not execute it again. "
			+ "The file must have been successfully executed with test, and its content must not have been modified after execution; the parameter definitions, class name list, name and logic description are given together with the path, and the tool constrains the shape; if submitted multiple times, the last one prevails. "
			+ "The body only writes a brief description, and no longer outputs the code and the full text of each tag.")
	public String submitAction(@P("Relative path of the Python file successfully executed in this workspace") String path,
			@P("Object list of parameter definitions, each item contains name, type, description, value, className") List<Map> parameterDefs,
			@P("List of object class names involved in the write operation") List<String> classNames,
			@P("Summary title of the write function's business meaning") String name,
			@P("Natural language description of the write function logic") String logic) throws Exception {
		String sessionId = AgentCallContext.current().getSessionId();
		Path file = workspaceService.resolve(sessionId, path);
		if (!file.toString().endsWith(".py") || !Files.isRegularFile(file)) {
			throw new IllegalArgumentException("The submission entry must be an existing Python file in the workspace");
		}
		AgentWorkspaceService.FileExecution executed = workspaceService.getExecution(sessionId, file.toString());
		if (executed == null) {
			return "Submission failed: the Python code of this file has not been tested, please test it with test first before submitting";
		}
		if (executed.error() != null && !executed.error().isBlank()) {
			return "Submission failed: the last program test of this file reported an error, please fix it and test again before submitting";
		}
		String content = Files.readString(file);
		if (!executed.content().equals(content)) {
			return "Submission failed: this file was modified again after testing, please test again before submitting";
		}
		JSONObject envelope = new JSONObject();
		envelope.put(CODE_KEY, content);
		if (parameterDefs != null) {
			envelope.put(PARAMETER_DEFS_KEY, parameterDefs);
		}
		envelope.put(CLASS_NAMES_KEY, classNames);
		envelope.put(NAME_KEY, name);
		envelope.put(LOGIC_KEY, logic);
		workspaceService.saveSubmission(sessionId, JSON.toJSONString(envelope, Feature.WriteMapNullValue));
		return "Submitted successfully";
	}

}
