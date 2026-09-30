package io.ontomato.dataengine.controller;

import java.util.ArrayList;
import java.util.List;

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
import io.ontomato.dataengine.bean.dashboard.DashboardCondition;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ABCProgramDashboardService;
import io.ontomato.dataengine.service.DashboardService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class DashboardController {
	
	@Autowired
	private DashboardService dashboardService;
	
	@Autowired
	private ABCProgramDashboardService abcProgramDashboardService;
	
	@Autowired
    private IdentityService identityService;
	
	@PostMapping("/dashboard/getConditionsFromDsls")
    @ResponseBody
    public JSONObject getConditionsFromDsls(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<JSONObject> dsls = param.getList("dsls", JSONObject.class);
			List<DashboardCondition> conditions = dashboardService.getConditionsFromDsls(dsls, user.getDomainId());
			ret.put("success", true);
			ret.put("data", conditions);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/dashboard/getAnswerByDslConditionParam")
    @ResponseBody
    public JSONObject getAnswerByDslConditionParam(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			UserDataPermission permission = identityService.getCurrentUserDataPermission();
			JSONObject dsl = param.getJSONObject("dsl");
			List<DashboardCondition> conditions = param.getList("conditions", DashboardCondition.class);
			JSONArray params = param.getJSONArray("params");
			List<JSONObject> parameters = null;
			if (params != null) {
				parameters = new ArrayList<JSONObject>();
				for (int i = 0; i < params.size(); i++) {
					parameters.add(params.getJSONObject(i));
				}
			}
			JSONObject answer = dashboardService.getAnswerByDslConditionParam(dsl, conditions, parameters, lang, permission, user.getDomainId());
			ret.put("success", true);
			ret.put("data", answer);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/dashboard/createFromABCProgram")
    @ResponseBody
    public JSONObject createFromABCProgram(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ABCHarnessProgram program = param.to(ABCHarnessProgram.class);
			Boolean needParameter = param.getBoolean("needParameter");
			if (needParameter == null) {
				needParameter = false;
			}
			ABCHarnessDashboard dashboard = abcProgramDashboardService.fromProgram(program, needParameter, lang, user.getDomainId());
			if (dashboard != null) {
				ret.put("success", true);
				ret.put("data", dashboard);
			} else {
				throw new Exception("Failed to generate Dashboard");
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

}
