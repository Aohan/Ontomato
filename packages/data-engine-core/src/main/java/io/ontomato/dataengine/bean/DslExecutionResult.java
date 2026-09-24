package io.ontomato.dataengine.bean;

import java.io.PrintWriter;
import java.io.StringWriter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

public record DslExecutionResult(JSONObject data, Failure failure) {

	public record Failure(Exception cause) {}

	public static DslExecutionResult success(JSONObject data) {
		return new DslExecutionResult(data, null);
	}

	public static DslExecutionResult failure(JSONObject data, Exception cause) {
		return new DslExecutionResult(data, new Failure(cause));
	}

	public boolean failed() {
		return failure != null;
	}

	public DslExecutionResult copy() {
		JSONObject copiedData = JSONObject.parseObject(JSON.toJSONString(data, Feature.WriteMapNullValue));
		return new DslExecutionResult(copiedData, failure);
	}

	public JSONObject rawResponse() {
		JSONObject response = new JSONObject();
		response.putAll(data);
		if (failure != null) {
			StringWriter stackTrace = new StringWriter();
			failure.cause().printStackTrace(new PrintWriter(stackTrace));
			response.put("error", stackTrace.toString());
		}
		return response;
	}
}
