package io.ontomato.dataengine.controller;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class ABCProgramController {
	
	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private ABCProgramService abcProgramService;
	
	@Autowired
	private BusinessConfigService businessConfigService;

	@PostMapping("/abcProgram/execute")
    @ResponseBody
    public JSONObject execute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			ABCHarnessProgram program = param.to(ABCHarnessProgram.class);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			JSONArray answer = abcProgramService.execute(UUID.randomUUID().toString(), program, user.getId(), curUserDataPermission, lang, timeoutMinutes, user.getDomainId());
			ret.put("success", true);
			ret.put("data", answer);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
        return ret;
    }
	
	@PostMapping("/abcProgram/queryDataByDashboard")
    @ResponseBody
    public JSONObject queryDataByDashboard(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			ABCHarnessDashboard dashboard = param.to(ABCHarnessDashboard.class);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			JSONArray answer = abcProgramService.execute(UUID.randomUUID().toString(), dashboard, user.getId(), curUserDataPermission, lang, timeoutMinutes, user.getDomainId());
			ret.put("success", true);
			ret.put("data", answer);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
        return ret;
    }
	
}
