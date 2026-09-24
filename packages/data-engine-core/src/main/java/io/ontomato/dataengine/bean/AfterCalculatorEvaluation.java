package io.ontomato.dataengine.bean;

public class AfterCalculatorEvaluation {

	private String sessionId;
	private String question;
	private String calculatorType;
	private String userMessage;
	
	private String code;
	private String logic;
	
	private Boolean notWaitInput;
	private Boolean outputOk;
	
	private Boolean coverLogicOk;
	private String coverLogicConclusion;
	
	private Boolean pass;
	
	public static final String NOT_CALL_TYPE = "NOT_CALL";
	public static final String PYTHON_CALCULATOR_TYPE = "PYTHON_CALCULATOR";
	public static final String TOOLS_CALCULATOR_TYPE = "TOOLS_CALCULATOR";
	
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
	public String getCalculatorType() {
		return calculatorType;
	}
	public void setCalculatorType(String calculatorType) {
		this.calculatorType = calculatorType;
	}
	public String getUserMessage() {
		return userMessage;
	}
	public void setUserMessage(String userMessage) {
		this.userMessage = userMessage;
	}
	public Boolean getPass() {
		return pass;
	}
	public void setPass(Boolean pass) {
		this.pass = pass;
	}
	
	public String getCode() {
		return code;
	}
	public void setCode(String code) {
		this.code = code;
	}
	public String getLogic() {
		return logic;
	}
	public void setLogic(String logic) {
		this.logic = logic;
	}
	public Boolean getNotWaitInput() {
		return notWaitInput;
	}
	public void setNotWaitInput(Boolean notWaitInput) {
		this.notWaitInput = notWaitInput;
	}
	public Boolean getOutputOk() {
		return outputOk;
	}
	public void setOutputOk(Boolean outputOk) {
		this.outputOk = outputOk;
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
