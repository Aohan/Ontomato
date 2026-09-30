package io.ontomato.dataengine.bean.dashboard;

import lombok.Data;

@Data
public class DashboardConditionVectorOutput extends DashboardCondition {

	private Integer outputFieldIndex;
	private String className;
	private String attrName;
	
}
