package io.ontomato.dataengine.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SseEmitterUtil;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class MetricViewController {

	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private MetricViewService metricViewService;
	
	@Autowired
	private LangService langService;

	@Autowired
	private BackendSessionEntrance sessionEntrance;
	
	@PostMapping("/metricView/generateFromNatureLanguage")
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
			MetricView metricView = metricViewService.generateFromNatureLanguage(question, lang, user.getDomainId(), persistence);
			if (metricView == null) {
				throw new Exception(langService.get(lang, "MetricView.notGenerated"));
			}
			ret.put("success", true);
			ret.put("data", metricView);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			MetricView metricView = param.to(MetricView.class);
			metricView.setDomainId(user.getDomainId());
			metricViewService.save(metricView, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			metricViewService.delete(id, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			MetricView metricView = metricViewService.queryById(id);
			ret.put("success", true);
			ret.put("data", metricView);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String type = param.getString("type");
			String status = param.getString("status");
			String className = param.getString("className");
			List<MetricView> metricViews = metricViewService.queryList(type, status, null, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", metricViews);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/find")
    @ResponseBody
    public JSONObject find(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			String className = param.getString("className");
			List<MetricView> metricViews;
			if (question == null || "".equals(question.trim())) {
				metricViews = metricViewService.queryList(null, MetricView.STATUS_PUBLISHED, null, className, user.getDomainId());
			} else {
				metricViews = metricViewService.find(question.trim(), className, user.getDomainId());
			}
			JSONArray metricViewDefs = new JSONArray();
			for (MetricView metricView : metricViews) {
				JSONObject metricViewDef = new JSONObject();
				metricViewDef.put("id", metricView.getId());
				metricViewDef.put("name", metricView.getName());
				metricViewDef.put("logic", metricView.getFunction().getLogic());
				if (MetricView.TYPE_GENERAL.equals(metricView.getType())) {
					metricViewDef.put("parameters", metricView.getFunction().getParameters());
				} else {
					metricViewDef.put("parameters", new ArrayList<Parameter>());
				}
				metricViewDef.put("returnDef", metricView.getFunction().getReturnDef());
				metricViewDefs.add(metricViewDef);
			}
			ret.put("success", true);
			ret.put("data", metricViewDefs);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/test")
    @ResponseBody
    public JSONObject test(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			MetricView metricView = param.to(MetricView.class);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			MetricViewContent metricViewContent = metricViewService.test(metricView, lang, user, curUserDataPermission, timeoutMinutes);
			ret.put("success", true);
			ret.put("data", metricViewContent);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping(path = "/metricView/generateGeneralContent", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generateGeneralContent(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
    	User user = SystemUtils.getCurUser();
		String question = param.getString("question");
		Boolean testParam = param.getBoolean("test");
		boolean testFlag = testParam == null ? false : testParam;
		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
		if (timeoutMinutes <= 0) {
			timeoutMinutes = 1;
		}
		final int queryTimeoutMinutes = timeoutMinutes;
		return sessionEntrance.openNewSessionStream(param, "generateGeneralContent", streamId -> {
			try {
				List<MetricViewContent> metricViewContents = metricViewService.generateGeneralContent(streamId, question, lang, user, curUserDataPermission, queryTimeoutMinutes, testFlag);
				JSONObject ret = new JSONObject();
				ret.put("success", true);
				ret.put("data", metricViewContents);
				SseEmitterUtil.sendSseEmitter(streamId, JSON.toJSONString(ret));
			} catch (SessionCancelledException e) {
				// Do not swallow a cancellation into a failure result frame: rethrow as-is and let the entrance cancellation branch handle it.
				throw e;
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				JSONObject ret = new JSONObject();
				ret.put("success", false);
				ret.put("message", failureMessage(e));
				SseEmitterUtil.sendSseEmitter(streamId, JSON.toJSONString(ret));
			}
		});
	}
	
	@PostMapping("/metricView/generateStaticContent")
    @ResponseBody
    public JSONObject generateStaticContent(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			List<MetricViewContent> metricViewContents = metricViewService.generateStaticContent(question, lang, user, curUserDataPermission, timeoutMinutes);
			ret.put("success", true);
			ret.put("data", metricViewContents);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", failureMessage(e));
		}
		return ret;
	}
	
	@GetMapping("/metricView/getData")
	@ResponseBody
	public JSONObject getData(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestParam String parameter) throws Exception {
		return metricViewService.getData(parameter.trim(), lang);
	}
	
	@PostMapping("/metricView/execute")
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
			JSONArray data = metricViewService.execute(id, p, lang, user, curUserDataPermission, timeoutMinutes);
			ret.put("success", true);
			ret.put("data", data);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/testExecute")
    @ResponseBody
    public JSONObject testExecute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			MetricView metricView = param.getJSONObject("metricView").to(MetricView.class);
			JSONObject p = param.getJSONObject("param");
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			JSONArray data = metricViewService.testExecute(metricView, p, lang, user, curUserDataPermission, timeoutMinutes);
			ret.put("success", true);
			ret.put("data", data);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	private String failureMessage(Exception e) {
		String message = e.getMessage();
		if (message == null || message.isBlank()) {
			return e.getClass().getName();
		}
		return message;
	}
	
}
