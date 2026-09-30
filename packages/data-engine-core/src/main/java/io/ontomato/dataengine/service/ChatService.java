package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ChatService {

    public JSONArray chat(String sessionId, Long timeout, String domainId);
    
    public DslCookerEvaluation generateDsl(String question, int subQueryIndex, JSONObject subQuery, String sessionId, String originSessionId, String domainId);
    
    public JSONObject splitQuestion(String question, String sessionId, List<String> classNames, boolean returnNodeIds, String lang, UserDataPermission curUserDataPermission, User user, boolean isV0);
    
    public void saveCard(Map<String, Object> input, String lang, String domainId);
    
    public Map<String,Object> getM3Data(String queryJson, UserDataPermission permission, String domainId);
    
    public JSONArray getMidSet(JSONObject dsl, UserDataPermission permission, String domainId);
    
    public Integer getTaskCountInQueue();
    
}
