package io.ontomato.dataengine.bean.abcQuestion;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.Data;

@Data
public class ABCSubQueryTask {

	public static final String DSL_TYPE = "DSL_TYPE";
	public static final String AFTER_CALCULATE_TYPE = "AFTER_CALCULATE_TYPE";
	
	private String id;
	private String sessionId;
	private String question;
	private JSONObject subQuery;
	private String type;
	private Integer index;
	private Boolean returnNodeIds;
	private Boolean returnSSE;
	private UserDataPermission permission;
//	private String domainId;
	private JSONObject dataMap;
	private Map<String, Object> cacheSchemaDef;
	private JSONObject rowPermissionDataMap;
	private List<Map<String, DslConsanguinity>> dslConsanguinityMapList;
	private List<AfterCalculatorConsanguinity> afterCalculatorConsanguinityList;
	
}
