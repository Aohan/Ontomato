package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class FunctionController {
	
	@Autowired
	private FunctionService functionService;

	@PostMapping("/function/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Function function = param.to(Function.class);
			function.setDomainId(user.getDomainId());
			functionService.save(function, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/function/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			functionService.delete(id, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/function/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			Function function = functionService.queryById(id);
			ret.put("success", true);
			ret.put("data", function);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/function/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String operation = param.getString("operation");
			String className = param.getString("className");
			List<Function> functions = functionService.queryList(operation, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", functions);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
