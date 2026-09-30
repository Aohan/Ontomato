package io.ontomato.dataengine.bean.dashboard;

import lombok.Data;

@Data
public class DashboardConditionVectorWhere extends DashboardCondition {

	private Integer objectIndex;
	private Integer condIndex;
	private String className;
	private String attrName;
	
}
