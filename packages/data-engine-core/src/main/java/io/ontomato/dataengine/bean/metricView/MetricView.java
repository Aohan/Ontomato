package io.ontomato.dataengine.bean.metricView;

import java.util.Set;

import io.ontomato.dataengine.bean.function.Function;

import lombok.Data;

@Data
public class MetricView {
	
	public static final String STATUS_PENDING_REVIEW = "PENDING_REVIEW";
	public static final String STATUS_PUBLISHED = "PUBLISHED";
	public static final String STATUS_UNUSED = "UNUSED";
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";
	
	public static final String TYPE_GENERAL = "GENERAL";
	public static final String TYPE_STATIC = "STATIC";

	private String id;
	private String name;
	private String origin;
	private String type;
	private Function function;
	private String description;
	private String status;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private Set<String> matchQuestions;
	private String domainId;
	private String originQuestion;
	private OriginCheckResult originCheckResult;
	
}
