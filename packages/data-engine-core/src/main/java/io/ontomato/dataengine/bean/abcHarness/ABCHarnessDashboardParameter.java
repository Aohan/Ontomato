package io.ontomato.dataengine.bean.abcHarness;

import lombok.Data;

@Data
public class ABCHarnessDashboardParameter {
	
	public static final String VALUE_TYPE_STRING = "STRING";
	public static final String VALUE_TYPE_NUMBER = "NUMBER";
	public static final String VALUE_TYPE_TIME = "TIME";
	public static final String VALUE_TYPE_STRING_ARRAY = "STRING_ARRAY";
	public static final String VALUE_TYPE_NUMBER_ARRAY = "NUMBER_ARRAY";
	public static final String VALUE_TYPE_TIME_ARRAY = "TIME_ARRAY";

	private String key;
	private String name;
	private String type;
	private Object value;
	private String className;
	private String attrName;
	
}
