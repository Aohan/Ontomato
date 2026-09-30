package io.ontomato.dataengine.bean;

import lombok.Data;

@Data
public class CheckTask {

	private String id;
	private String question;
	private CheckSubQueryTask[] subQueryTasks;
	private CheckAfterCalculateTask[] afterCalculateTasks;
	private String status;
	private Double score;
	private String conclusion;
	private String fittedQuestion;
	private Long createTimestamp;
	private String serviceId;
	private String lang;
	private String domainId;
	
	public static final String STATUS_CREATE = "CREATE";
	public static final String STATUS_SUB_QUERY_CHECKING = "SUB_QUERY_CHECKING";
	public static final String STATUS_AFTER_CALCULATE_CHECKING = "AFTER_CALCULATE_CHECKING";
	public static final String STATUS_FINAL_CHECKING = "FINAL_CHECKING";
	public static final String STATUS_FINISH = "FINISH";
	
}
