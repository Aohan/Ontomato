package io.ontomato.dataengine.bean;

import java.util.List;

public class AfterCalculatorConsanguinity {
	
	public class Source {
		private Integer subQueryIndex;
		private String inputKey;
		public Integer getSubQueryIndex() {
			return subQueryIndex;
		}
		public void setSubQueryIndex(Integer subQueryIndex) {
			this.subQueryIndex = subQueryIndex;
		}
		public String getInputKey() {
			return inputKey;
		}
		public void setInputKey(String inputKey) {
			this.inputKey = inputKey;
		}
	}

	private String outputKey;
	private List<Source> sources;
	private String type;
	private String comment;
	public String getOutputKey() {
		return outputKey;
	}
	public void setOutputKey(String outputKey) {
		this.outputKey = outputKey;
	}
	public List<Source> getSources() {
		return sources;
	}
	public void setSources(List<Source> sources) {
		this.sources = sources;
	}
	public String getType() {
		return type;
	}
	public void setType(String type) {
		this.type = type;
	}
	public String getComment() {
		return comment;
	}
	public void setComment(String comment) {
		this.comment = comment;
	}
	
}
