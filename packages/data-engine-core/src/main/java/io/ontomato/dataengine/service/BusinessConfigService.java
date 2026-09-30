package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;

public interface BusinessConfigService {

	public void set(BusinessConfig businessConfig, String domainId);
	
	public BusinessConfig get(String domainId);
	
	public JSONObject getRuntimeWholeConfig(String domainId);
	
	public String getWholeConfigDesc();
	
}
