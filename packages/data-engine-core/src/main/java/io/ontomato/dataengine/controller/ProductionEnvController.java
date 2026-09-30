package io.ontomato.dataengine.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.EnvService;

@RestController
public class ProductionEnvController {
	
	@Autowired
	private EnvService envService;

	@PostMapping("/productionEnv/queryData")
    @ResponseBody
    public JSONObject queryData(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			JSONObject dsl = validDslJsonFormat(param);
			ret = envService.executeDslInProductionEnv(dsl);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	private JSONObject validDslJsonFormat(JSONObject param) throws Exception {
		try {
			JSONObject dsl = param.getJSONObject("dsl");
			if (dsl == null) {
				throw new Exception();
			}
			return dsl;
		} catch (Exception e) {
			try {
				JSONArray dsls = param.getJSONArray("dsl");
				return dsls.getJSONObject(0);
			} catch (Exception e1) {
				throw new Exception(e1.getMessage());
			}
		}
	}
	
	@PostMapping("/productionEnv/queryDistinctAttrValue")
    @ResponseBody
    public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String like = param.getString("like");
			Integer limit = param.getInteger("limit");
			ret.put("success", true);
			ret.put("data", envService.queryDistinctAttrValueInProductionEnv(className, attrName, like, limit == null ? 0 : limit));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
		
	}
	
	@PostMapping("/productionEnv/queryBusinessKnowledge")
    @ResponseBody
    public JSONObject queryBusinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String question = param.getString("question");
			Integer max_result = param.getInteger("max_result");
			String md = envService.queryBusinessKnowledgeInProductionEnv(question, max_result);
			ret.put("success", true);
			ret.put("data", md);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
