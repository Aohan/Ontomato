package io.ontomato.dataengine.bean;

public class AnalysisQuestionAnalyst {

	private String id;
	private String name;
	private String spliterPrompt;
	private String summarizerPrompt;
	private String conclusionMakerPrompt;
	private Long createTimestamp;
	private Long modifyTimestamp;
	
	public String getId() {
		return id;
	}
	public void setId(String id) {
		this.id = id;
	}
	public String getName() {
		return name;
	}
	public void setName(String name) {
		this.name = name;
	}
	public String getSpliterPrompt() {
		return spliterPrompt;
	}
	public void setSpliterPrompt(String spliterPrompt) {
		this.spliterPrompt = spliterPrompt;
	}
	public String getSummarizerPrompt() {
		return summarizerPrompt;
	}
	public void setSummarizerPrompt(String summarizerPrompt) {
		this.summarizerPrompt = summarizerPrompt;
	}
	public String getConclusionMakerPrompt() {
		return conclusionMakerPrompt;
	}
	public void setConclusionMakerPrompt(String conclusionMakerPrompt) {
		this.conclusionMakerPrompt = conclusionMakerPrompt;
	}
	public Long getCreateTimestamp() {
		return createTimestamp;
	}
	public void setCreateTimestamp(Long createTimestamp) {
		this.createTimestamp = createTimestamp;
	}
	public Long getModifyTimestamp() {
		return modifyTimestamp;
	}
	public void setModifyTimestamp(Long modifyTimestamp) {
		this.modifyTimestamp = modifyTimestamp;
	}
	
}
