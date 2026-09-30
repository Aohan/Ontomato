package io.ontomato.dataengine.bean;

import lombok.Data;

@Data
public class PythonExecuteResult {

	private String result;
	private String error;
	private Long spendTime;
	
}
