package io.ontomato.dataengine.bean.task;

import lombok.Data;

@Data
public class WriteTaskResult {

	private String id;
	private String writeTaskId;
	private Long executeTimestamp;
	private String result;
	private String error;
	private Long spendTime;
	
}
