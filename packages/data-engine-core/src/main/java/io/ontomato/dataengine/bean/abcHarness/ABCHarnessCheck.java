package io.ontomato.dataengine.bean.abcHarness;

import java.util.List;

import lombok.Data;

@Data
public class ABCHarnessCheck {

	private String sessionId;
	private String originQuestion;
	private List<ABCHarnessProgramDescription> programDescriptions;
	private Double score;
	private String conclusion;
	private String fittedQuestion;
	private String lang;
	private Long createTimestamp;
	private Boolean finished;
	
}
