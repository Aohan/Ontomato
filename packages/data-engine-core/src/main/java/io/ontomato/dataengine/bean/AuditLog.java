package io.ontomato.dataengine.bean;

import lombok.Data;

@Data
public class AuditLog {
	
	public static final String BUSSINESS_BKNOWLEDGE = "BKNOWLEDGE";
	public static final String BUSSINESS_BEXAMPLE = "BEXAMPLE";
	public static final String BUSSINESS_SCHEMA = "SCHEMA";
	public static final String BUSSINESS_ANALYSIS = "ANALYSIS";
	
	public static final String OPERATION_ADD = "ADD";
	public static final String OPERATION_UPD = "UPD";
	public static final String OPERATION_DEL = "DEL";

	private String id;
	private String domainId;
	private String bussiness;
	private Boolean byAi;
	private String userId;
	private String userName;
	private String operation;
	private String description;
	private String paramter;
	private Long operateTime;
	
}
