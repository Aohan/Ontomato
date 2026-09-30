package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface MetricViewService {
	
	public MetricView generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception;

	public MetricView generateFromFunction(Function function);
	
	public MetricView save(MetricView metricView, String lang) throws Exception;
	
	public void delete(String id, String lang) throws Exception;
	
	public MetricView queryById(String id);
	
	public List<MetricView> queryList(String type, String status, String functionId, String className, String domainId);
	
	public List<MetricView> find(String question, String className, String domainId);
	
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	public List<MetricViewContent> generateGeneralContent(String sessionId, String question, String lang, User user, UserDataPermission permission, int timeoutMinutes, boolean test);
	
	public List<MetricViewContent> generateStaticContent(String question, String lang, User user, UserDataPermission permission, int timeoutMinutes);
	
	public JSONObject getData(String shortCode, String lang) throws Exception;
	
	public JSONArray execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	public JSONArray testExecute(MetricView metricView, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
}
