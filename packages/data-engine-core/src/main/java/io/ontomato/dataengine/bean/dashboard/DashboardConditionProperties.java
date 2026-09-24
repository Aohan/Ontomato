package io.ontomato.dataengine.bean.dashboard;

import lombok.Data;

@Data
public class DashboardConditionProperties extends DashboardCondition {

	private Integer objectIndex;
	private Integer condOrder;
	private String className;
	private String attrName;
	private String operator;
	
}
