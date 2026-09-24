package io.ontomato.dataengine.bean.abcHarness;

import com.alibaba.fastjson2.JSONObject;

import lombok.Data;

@Data
public class ABCHarnessTaskMessage {
	
	public static final String MESSAGE_TYPE = "MESSAGE_TYPE";
	public static final String DATA_TYPE = "DATA_TYPE";

	private String sessionId;
	private String type;
	private JSONObject content;
	
}
