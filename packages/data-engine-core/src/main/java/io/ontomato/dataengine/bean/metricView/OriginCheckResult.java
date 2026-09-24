package io.ontomato.dataengine.bean.metricView;

import lombok.Data;

@Data
public class OriginCheckResult {

	private Double score;
	private String conclusion;
	private String fittedQuestion;
	
}
