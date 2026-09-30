package io.ontomato.dataengine.bean;

import java.util.List;

import lombok.Data;

@Data
public class CheckAfterCalculateTask {

	private String id;
	private String logic;
	private List<String> cacheFilePaths;
	private String summary;
	private String meaning;
	
}
