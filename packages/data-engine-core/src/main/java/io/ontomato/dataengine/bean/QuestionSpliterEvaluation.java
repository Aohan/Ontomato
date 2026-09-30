package io.ontomato.dataengine.bean;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;

public class QuestionSpliterEvaluation {
	
	public class SubQueryConclusion {
		private Boolean pass;
		private String conclusion;
		private List<Integer> dependOnIndexes;

		public Boolean getPass() {
			return pass;
		}
		public void setPass(Boolean pass) {
			this.pass = pass;
		}
		public String getConclusion() {
			return conclusion;
		}
		public void setConclusion(String conclusion) {
			this.conclusion = conclusion;
		}
		public List<Integer> getDependOnIndexes() {
			return dependOnIndexes;
		}
		public void setDependOnIndexes(List<Integer> dependOnIndexes) {
			this.dependOnIndexes = dependOnIndexes;
		}
	}

	private String sessionId;
	private String question;
	private String userMessage;
	private String userMessageWithoutExample;
	private JSONObject answerObj;
	private Boolean subQueryOk;
	private List<SubQueryConclusion> subQueryConclusions;
	private Boolean dependOk;
	private Boolean coverLogicOk;
	private String coverLogicConclusion;
	
	public String getSessionId() {
		return sessionId;
	}
	public void setSessionId(String sessionId) {
		this.sessionId = sessionId;
	}
	public String getQuestion() {
		return question;
	}
	public void setQuestion(String question) {
		this.question = question;
	}
	public String getUserMessage() {
		return userMessage;
	}
	public void setUserMessage(String userMessage) {
		this.userMessage = userMessage;
	}
	public String getUserMessageWithoutExample() {
		return userMessageWithoutExample;
	}
	public void setUserMessageWithoutExample(String userMessageWithoutExample) {
		this.userMessageWithoutExample = userMessageWithoutExample;
	}
	public JSONObject getAnswerObj() {
		return answerObj;
	}
	public void setAnswerObj(JSONObject answerObj) {
		this.answerObj = answerObj;
	}
	public Boolean getSubQueryOk() {
		return subQueryOk;
	}
	public void setSubQueryOk(Boolean subQueryOk) {
		this.subQueryOk = subQueryOk;
	}
	public List<SubQueryConclusion> getSubQueryConclusions() {
		return subQueryConclusions;
	}
	public void setSubQueryConclusions(List<SubQueryConclusion> subQueryConclusions) {
		this.subQueryConclusions = subQueryConclusions;
	}
	public Boolean getDependOk() {
		return dependOk;
	}
	public void setDependOk(Boolean dependOk) {
		this.dependOk = dependOk;
	}
	public Boolean getCoverLogicOk() {
		return coverLogicOk;
	}
	public void setCoverLogicOk(Boolean coverLogicOk) {
		this.coverLogicOk = coverLogicOk;
	}
	public String getCoverLogicConclusion() {
		return coverLogicConclusion;
	}
	public void setCoverLogicConclusion(String coverLogicConclusion) {
		this.coverLogicConclusion = coverLogicConclusion;
	}
	
}
