package io.ontomato.dataengine.bean;

import java.util.List;
import java.util.Map;

public class PythonCalculatorResult {

	private List<Map> answer;
	private List<AfterCalculatorConsanguinity> dataRef;

	private String userMessage;
	
	public List<Map> getAnswer() {
		return answer;
	}
	public void setAnswer(List<Map> answer) {
		this.answer = answer;
	}
	public List<AfterCalculatorConsanguinity> getDataRef() {
		return dataRef;
	}

	public void setDataRef(List<AfterCalculatorConsanguinity> dataRef) {
		this.dataRef = dataRef;
	}
	public String getUserMessage() {
		return userMessage;
	}
	public void setUserMessage(String userMessage) {
		this.userMessage = userMessage;
	}
	
}
