package io.ontomato.dataengine.controller;

import java.io.InputStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.EnvService;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
public class TestEnvController {
	
	@Autowired
	private EnvService envService;

	@GetMapping("/testEnv/importSchema")
    @ResponseBody
    public JSONObject importSchema() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			envService.importSchema(user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/testEnv/importData")
    @ResponseBody
    public JSONObject importTestData(@RequestParam(value = "file") MultipartFile file) {
		JSONObject ret = new JSONObject();
		InputStream is = null;
		try {
			User user = SystemUtils.getCurUser();
			is = file.getInputStream();
			envService.importTestData(is, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		} finally {
			if (is != null) {
				try {
					is.close();
				} catch (Exception e) {}
			}
		}
		return ret;
	}
	
}
