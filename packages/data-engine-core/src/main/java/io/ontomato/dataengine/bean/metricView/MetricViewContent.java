package io.ontomato.dataengine.bean.metricView;

import java.util.List;

import lombok.Data;

@Data
public class MetricViewContent {

	private String md;
	private String originQuestion;
	private OriginCheckResult originCheckResult;
	private List<String> parameterInstanceDesc;
	private String url;
	
}
