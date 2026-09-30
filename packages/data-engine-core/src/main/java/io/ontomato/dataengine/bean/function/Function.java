package io.ontomato.dataengine.bean.function;

import java.util.List;

import lombok.Data;

@Data
public class Function {
	
	public static final String OPERATION_READ = "OPERATION_READ";
	public static final String OPERATION_WRITE = "OPERATION_WRITE";
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";

	private String id;
	private String name;
	private String origin;
	private String description;
	private String operation;
	private List<Parameter> parameters;
	private ReturnDef returnDef;
	private String code;
	private String logic;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private String domainId;
	
}
