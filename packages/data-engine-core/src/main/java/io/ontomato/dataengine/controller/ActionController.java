package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class ActionController {

	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private ActionService actionService;

	@Autowired
	private LangService langService;
	
	@PostMapping("/action/generateFromNatureLanguage")
    @ResponseBody
    public JSONObject generateFromNatureLanguage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
	    	User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			Boolean persistence = param.getBoolean("persistence");
			if (persistence == null) {
				persistence = false;
			}
			Action action = actionService.generateFromNatureLanguage(question, lang, user.getDomainId(), persistence);
			if (action == null) {
				throw new Exception(langService.get(lang, "Action.notGenerated"));
			}
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Action action = param.to(Action.class);
			action.setDomainId(user.getDomainId());
			actionService.save(action, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			actionService.delete(id, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			Action action = actionService.queryById(id);
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param.getString("status");
			String className = param.getString("className");
			List<Action> actions = actionService.queryList(status, null, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", actions);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/find")
    @ResponseBody
    public JSONObject find(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			String className = param.getString("className");
			List<Action> actions;
			if (question == null || "".equals(question.trim())) {
				actions = actionService.queryList(Action.STATUS_PUBLISHED, null, className, user.getDomainId());
			} else {
				actions = actionService.find(question.trim(), className, user.getDomainId());
			}
			JSONArray actionDefs = new JSONArray();
			for (Action action : actions) {
				JSONObject actionDef = new JSONObject();
				actionDef.put("id", action.getId());
				actionDef.put("name", action.getName());
				actionDef.put("logic", action.getFunction().getLogic());
				actionDef.put("parameters", action.getFunction().getParameters());
				actionDef.put("returnDef", action.getFunction().getReturnDef());
				actionDefs.add(actionDef);
			}
			ret.put("success", true);
			ret.put("data", actionDefs);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/execute")
    @ResponseBody
    public JSONObject execute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			String id = param.getString("id");
			JSONObject p = param.getJSONObject("param");
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult result = actionService.execute(id, p, lang, user, curUserDataPermission, timeoutMinutes);
			if (result.getError() != null && !"".equals(result.getError().trim())) {
				throw new Exception(result.getError());
			}
			ret.put("success", true);
			ret.put("data", result);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
