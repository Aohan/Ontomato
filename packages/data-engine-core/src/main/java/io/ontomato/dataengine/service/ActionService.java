package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ActionService {
	
	public Action generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception;

	public Action save(Action action, String lang) throws Exception;
	
	public void delete(String id, String lang) throws Exception;
	
	public Action queryById(String id);
	
	public List<Action> queryList(String status, String functionId, String className, String domainId);
	
	public List<Action> find(String question, String className, String domainId);
	
	public PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
}
