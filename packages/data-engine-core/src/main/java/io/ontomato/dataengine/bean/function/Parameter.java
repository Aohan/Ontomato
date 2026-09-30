package io.ontomato.dataengine.bean.function;

import java.util.List;

import lombok.Data;

@Data
public class Parameter {

	public static final String TYPE_STRING = "TYPE_STRING";
	public static final String TYPE_NUMBER = "TYPE_NUMBER";
	public static final String TYPE_TIME = "TYPE_TIME";
	public static final String TYPE_STRING_ARRAY = "TYPE_STRING_ARRAY";
	public static final String TYPE_NUMBER_ARRAY = "TYPE_NUMBER_ARRAY";
	public static final String TYPE_TIME_ARRAY = "TYPE_TIME_ARRAY";
	public static final String TYPE_ONTOOBJ = "TYPE_ONTOOBJ";
	public static final String TYPE_DATASET = "TYPE_DATASET";
	public static final String TYPE_VECTOR = "TYPE_VECTOR";
	
	private String name;
	private String type;
	private String description;
	private Object sample;
	private Object value;
	private List<String> classNames;
	
}
