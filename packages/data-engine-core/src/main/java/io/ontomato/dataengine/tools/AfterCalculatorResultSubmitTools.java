package io.ontomato.dataengine.tools;

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

/** Only attached to TOOL_AND_PYTHON_CALCULATOR: results obtained directly after calling a skill / MCP tool are submitted through this channel. */
@Component
public class AfterCalculatorResultSubmitTools {

	@Autowired
	private AgentWorkspaceService workspaceService;

	@Tool("Submit the result obtained directly after calling a skill or MCP tool as this delivery; only register, do not execute. "
			+ "The shape is consistent with the chain execution result: answer is a non-empty result array, logic is the calculation logic description; if submitted multiple times, the last one prevails. "
			+ "The body only writes a brief description, and no longer outputs the full text of the result.")
	public String submitResult(@P("Direct result array, non-empty") List<Map> answer,
			@P(value = "Detailed calculation logic", required = false) String logic) throws Exception {
		if (answer == null || answer.isEmpty()) {
			return "Submission failed: the direct result is missing a non-empty answer array, please submit again";
		}
		JSONObject envelope = new JSONObject();
		envelope.put(AfterCalculatorSubmitTools.KIND_KEY, AfterCalculatorSubmitTools.KIND_RESULT);
		envelope.put(AfterCalculatorSubmitTools.ANSWER_KEY, answer);
		if (logic != null) {
			envelope.put(AfterCalculatorSubmitTools.LOGIC_KEY, logic);
		}
		workspaceService.saveSubmission(AgentCallContext.current().getSessionId(), JSON.toJSONString(envelope, Feature.WriteMapNullValue));
		return "Submitted successfully";
	}

}
