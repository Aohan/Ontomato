package io.ontomato.dataengine.service.impl;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.JSONCorrector;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.util.UserMessageUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class JSONCorrectorImpl implements JSONCorrector {
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private LangService langService;

	@Override
	public JSONObject parseObject(String str, String domainId, String sessionId) {
		JSONObject obj = null;
		try {
			obj = JSONObject.parseObject(str);
		} catch (Exception e) {
			try {
				obj = JSONObject.parseObject(correct(str, domainId, sessionId));
			} catch (SessionCancelledException cancelled) {
				throw cancelled;
			} catch (Exception e1) {
				log.error(e1.getMessage(), e1);
			}
		}
		return obj;
	}

	@Override
	public JSONArray parseArray(String str, String domainId, String sessionId) {
		JSONArray arr = null;
		try {
			arr = JSONArray.parseArray(str);
		} catch (Exception e) {
			try {
				arr = JSONArray.parseArray(correct(str, domainId, sessionId));
			} catch (SessionCancelledException cancelled) {
				throw cancelled;
			} catch (Exception e1) {
				log.error(e1.getMessage(), e1);
			}
		}
		return arr;
	}
	
	private String correct(String str, String domainId, String sessionId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String userMessage = UserMessageUtil.getJSONCorrectorUserMessage(str);
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(UUID.randomUUID().toString());
		String correctSessionId = BackendSessionEntrance.derive(sessionId, "json-corrector");
		String correctJsonStr = multiThreadAIChatService.chat(
				MultiThreadAIChatService.JSON_CORRECTOR,
				originalQuestion, 
				correctSessionId,
				userMessage,
				ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
				domainId);
		if (correctJsonStr.indexOf("```json") >= 0) {
			correctJsonStr = correctJsonStr.substring(correctJsonStr.indexOf("```json") + 7);
    		if (correctJsonStr.lastIndexOf("```") > 0) {
    			correctJsonStr = correctJsonStr.substring(0, correctJsonStr.lastIndexOf("```"));
    		}
    	}
		return correctJsonStr;
	}

}
