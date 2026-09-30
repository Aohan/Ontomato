package io.ontomato.dataengine.bean.dashboard;

import java.util.List;

import lombok.Data;

@Data
public class DashboardConditionTimeseriesOutput extends DashboardCondition {

	private Integer stepIndex;
	private Integer outputFieldIndex;
	private String className;
	private String attrName;
	private String indicatorName;
	private String function;
	private List<DashboardConditionTimeseriesOutputFilter> filters;
	
}
