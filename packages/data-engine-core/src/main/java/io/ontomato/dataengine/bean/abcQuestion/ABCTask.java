package io.ontomato.dataengine.bean.abcQuestion;

import lombok.Data;

@Data
public class ABCTask {

	private String sessionId;
	private boolean askFinished;
	private Long createTimestamp;
	
}
