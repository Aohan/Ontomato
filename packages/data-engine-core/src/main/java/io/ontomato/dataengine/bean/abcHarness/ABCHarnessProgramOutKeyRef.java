package io.ontomato.dataengine.bean.abcHarness;

import lombok.Data;

@Data
public class ABCHarnessProgramOutKeyRef {

	private String key;
	private String className;
	private String attrName;
	private Boolean asGroupBy;
	private Boolean statCal;
	
}
