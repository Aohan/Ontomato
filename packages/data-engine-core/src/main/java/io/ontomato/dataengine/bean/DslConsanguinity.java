package io.ontomato.dataengine.bean;

import java.util.Set;

public class DslConsanguinity {

	private String outputKey;
	private String className;
	private String attrName;
	private Set<String> indicatorNames;
	private String function;
	private Boolean asGroupBy;
	
	public String getOutputKey() {
		return outputKey;
	}
	public void setOutputKey(String outputKey) {
		this.outputKey = outputKey;
	}
	public String getClassName() {
		return className;
	}
	public void setClassName(String className) {
		this.className = className;
	}
	public String getAttrName() {
		return attrName;
	}
	public void setAttrName(String attrName) {
		this.attrName = attrName;
	}
	public Set<String> getIndicatorNames() {
		return indicatorNames;
	}
	public void setIndicatorNames(Set<String> indicatorNames) {
		this.indicatorNames = indicatorNames;
	}
	public String getFunction() {
		return function;
	}
	public void setFunction(String function) {
		this.function = function;
	}
	public Boolean getAsGroupBy() {
		return asGroupBy;
	}
	public void setAsGroupBy(Boolean asGroupBy) {
		this.asGroupBy = asGroupBy;
	}
	
}
