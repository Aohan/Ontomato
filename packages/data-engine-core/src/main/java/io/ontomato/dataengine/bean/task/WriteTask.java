package io.ontomato.dataengine.bean.task;

import io.ontomato.dataengine.bean.function.Function;

import lombok.Data;

@Data
public class WriteTask {
	
	public static final String STATUS_RUNNING = "RUNNING";
	public static final String STATUS_STOPPED = "STOPPED";

	private String id;
	private String name;
	private String description;
	private Function function;
	private String status;
	private String cron;
	private String serviceId;
	private String domainId;
	private Long createTimestamp;
	private Long modifyTimestamp;
	
}
