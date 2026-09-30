package io.ontomato.dataengine.bean.dashboard;

import java.util.List;

import lombok.Data;

@Data
public class DashboardConditionTimeseriesOutputValue {

	private String start;
	private String end;
	private List<Object> filterValues;
	
}
