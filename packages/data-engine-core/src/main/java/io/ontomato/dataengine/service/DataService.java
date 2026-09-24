package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface DataService {
	
	public void refreshStarChartData(String domainId);

	public JSONObject queryWholeDataMode0(String domainId);
	
	public JSONObject queryWholeDataMode1(String domainId);
	
	public JSONObject queryNextByNode(JSONObject node, String lang, String domainId);
	
	public JSONObject queryInfoByNode(JSONObject node, String lang, UserDataPermission permission, String domainId);

	public JSONObject fullTextSearch(JSONObject textSearch, String lang, UserDataPermission permission, String domainId);

	public JSONObject getClassAndCount(String lang, UserDataPermission permission, String domainId);

	public JSONObject getClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId);
	
	public JSONObject getWholeClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId);
	
	public List<String> queryDistinctAttrValue(String className, String attrName, String query, UserDataPermission permission, String domainId) throws Exception;

}
