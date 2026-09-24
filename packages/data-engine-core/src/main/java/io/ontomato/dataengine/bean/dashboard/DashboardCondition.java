package io.ontomato.dataengine.bean.dashboard;

import lombok.Data;

@Data
public class DashboardCondition {
	
	public static final String TYPE_PROPERTIES = "PROPERTIES";
	public static final String TYPE_TIMESERIES_WHERE = "TYPE_TIMESERIES_WHERE";
	public static final String TYPE_TIMESERIES_OUTPUT = "TYPE_TIMESERIES_OUTPUT";
	public static final String TYPE_VECTOR_WHERE = "VECTOR_WHERE";
	public static final String TYPE_VECTOR_OUTPUT = "VECTOR_OUTPUT";
	public static final String TYPE_LIMIT = "LIMIT";
	
	public static final String VALUE_TYPE_STRING = "STRING";
	public static final String VALUE_TYPE_NUMBER = "NUMBER";
	public static final String VALUE_TYPE_TIME = "TIME";
	public static final String VALUE_TYPE_STRING_ARRAY = "STRING_ARRAY";
	public static final String VALUE_TYPE_NUMBER_ARRAY = "NUMBER_ARRAY";
	public static final String VALUE_TYPE_TIME_ARRAY = "TIME_ARRAY";
	public static final String VALUE_TYPE_TIMESERIES_WHERE = "TIMESERIES_WHERE";
	public static final String VALUE_TYPE_TIMESERIES_OUTPUT = "TIMESERIES_OUTPUT";

	private Integer dslIndex;
	private String question;
	private String type;
	private Object originSample;
	private String valueType;
	
}
