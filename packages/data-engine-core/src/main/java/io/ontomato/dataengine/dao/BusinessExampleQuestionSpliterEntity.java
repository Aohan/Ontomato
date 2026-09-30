package io.ontomato.dataengine.dao;

import java.util.List;

import lombok.Data;

@Data
public class BusinessExampleQuestionSpliterEntity {

	private String id;
	private String question;
	private String content;
	private int status;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private List<Float> examplevector;
	
}
