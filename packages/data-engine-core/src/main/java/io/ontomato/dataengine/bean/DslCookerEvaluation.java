package io.ontomato.dataengine.bean;

import java.util.List;

public class DslCookerEvaluation {
	
	public class Illegal {
		private String type;
		private String conclusion;
		public String getType() {
			return type;
		}
		public void setType(String type) {
			this.type = type;
		}
		public String getConclusion() {
			return conclusion;
		}
		public void setConclusion(String conclusion) {
			this.conclusion = conclusion;
		}
	}

	private String sessionId;
	private String question;
	private String userMessage;
	private String userMessageWithoutExample;
	private String abcQuestion;
	private String dslStr;
	private String dslStrWithoutTimeConvert;
	private Boolean pass;
	private List<Illegal> illegals;
	
	public static final String CHECKJSON_OTHER_ILLEGAL_TYPE = "CHECKJSON_OTHER";
	public static final String STEP_ILLEGAL_TYPE = "STEP";
	public static final String WHERE_ILLEGAL_TYPE = "WHERE";
	public static final String RELATION_ILLEGAL_TYPE = "RELATION";
	public static final String SELECT_ILLEGAL_TYPE = "SELECT";
	public static final String PATTERN_ILLEGAL_TYPE = "PATTERN";
	public static final String GRAPH_ILLEGAL_TYPE = "GRAPH";
	public static final String ANSWER_ILLEGAL_TYPE = "ANSWER";
	public static final String GROUPBY_ILLEGAL_TYPE = "GROUPBY";
	public static final String HAVING_ILLEGAL_TYPE = "HAVING";
	public static final String FUNCTION_ILLEGAL_TYPE = "FUNCTION";
	public static final String COVER_LOGIC_ILLEGAL_TYPE = "COVER_LOGIC";
	public static final String OTHER_ILLEGAL_TYPE = "OTHER";
	
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
	public String getAbcQuestion() {
		return abcQuestion;
	}
	public void setAbcQuestion(String abcQuestion) {
		this.abcQuestion = abcQuestion;
	}
	public String getDslStr() {
		return dslStr;
	}
	public void setDslStr(String dslStr) {
		this.dslStr = dslStr;
	}
	public String getDslStrWithoutTimeConvert() {
		return dslStrWithoutTimeConvert;
	}
	public void setDslStrWithoutTimeConvert(String dslStrWithoutTimeConvert) {
		this.dslStrWithoutTimeConvert = dslStrWithoutTimeConvert;
	}
	public Boolean getPass() {
		return pass;
	}
	public void setPass(Boolean pass) {
		this.pass = pass;
	}
	public List<Illegal> getIllegals() {
		return illegals;
	}
	public void setIllegals(List<Illegal> illegals) {
		this.illegals = illegals;
	}
}
