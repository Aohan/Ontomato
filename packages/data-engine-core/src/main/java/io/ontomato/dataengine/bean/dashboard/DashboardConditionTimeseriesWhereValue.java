package io.ontomato.dataengine.bean.dashboard;

import java.util.List;

import lombok.Data;

@Data
public class DashboardConditionTimeseriesWhereValue {

	private String start;
	private String end;
	private List<Object> assertValues;
	
}
