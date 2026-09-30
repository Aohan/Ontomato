package io.ontomato.dataengine.bean;

import java.util.List;
import java.util.Map;

public class ToolsCalculatorResult {

	private List<Map> answer;
	private String logic;
	private String userMessage;
	
	public List<Map> getAnswer() {
		return answer;
	}
	public void setAnswer(List<Map> answer) {
		this.answer = answer;
	}
	public String getLogic() {
		return logic;
	}
	public void setLogic(String logic) {
		this.logic = logic;
	}
	public String getUserMessage() {
		return userMessage;
	}
	public void setUserMessage(String userMessage) {
		this.userMessage = userMessage;
	}
	
}
