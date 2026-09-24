package io.ontomato.dataengine.bean.action;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.bean.function.Function;

import lombok.Data;

@Data
public class Action {
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";
	
	public static final String STATUS_PENDING_REVIEW = "PENDING_REVIEW";
	public static final String STATUS_PUBLISHED = "PUBLISHED";
	public static final String STATUS_UNUSED = "UNUSED";

	private String id;
	private String name;
	private String description;
	private String origin;
	private Function function;
	private JSONArray codeSegments;
	private BusinessMeaning businessMeaning;
	private String status;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private String domainId;
	
}
