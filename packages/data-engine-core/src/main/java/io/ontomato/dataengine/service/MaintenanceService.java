package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;

public interface MaintenanceService {
    public JSONObject getServicesInfo();
    public JSONObject serviceAction(String serviceName, String action);
}
