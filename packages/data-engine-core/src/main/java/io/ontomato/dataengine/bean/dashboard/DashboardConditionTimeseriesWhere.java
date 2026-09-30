package io.ontomato.dataengine.bean.dashboard;

import java.util.List;

import lombok.Data;

@Data
public class DashboardConditionTimeseriesWhere extends DashboardCondition {

	private Integer stepIndex;
	private Integer objectIndex;
	private Integer condIndex;
	private String className;
	private String attrName;
	private String indicatorName;
	private List<DashboardConditionTimeseriesWhereAssert> asserts;
	
}
