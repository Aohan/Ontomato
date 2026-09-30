package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ABCHarnessService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.ChatService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.LogHelper;
import io.ontomato.dataengine.util.SseEmitterUtil;
import io.ontomato.dataengine.util.SystemUtils;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

@RestController
public class ChatController {

	@Autowired
    private ChatService chatService;

	@Autowired
    private ABCHarnessService abcHarnessService;

	@Autowired
    private LangService langService;

    @Autowired
    private IdentityService identityService;

    @Autowired
    private BackendSessionEntrance sessionEntrance;

    @PostMapping("/chatV1")
    @ResponseBody
    public JSONArray chatV1(@RequestBody JSONObject param) {
        return sessionEntrance.withContinuedSession(param.getString("sessionId"), param, sessionId -> {
        	User user = SystemUtils.getCurUser();
            LogHelper.info("Received question>>>:\n{}", param);

            return chatService.chat(sessionId, null, user.getDomainId());
        });
    }

    @PostMapping(path = "/streamchatV1", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter postStreamChatV1(@RequestBody JSONObject param) {
        String sessionId = param.getString("sessionId");
    	User user = SystemUtils.getCurUser();
        LogHelper.info("Received question>>>:\n{}", param);
        return sessionEntrance.openContinuedSessionStream(sessionId, param, "streamchatV1", streamId -> {
            JSONArray response = chatService.chat(streamId, null, user.getDomainId());
            SseEmitterUtil.sendSseEmitter(streamId, JSON.toJSONString(response, Feature.WriteMapNullValue));
        });
    }

    @PostMapping("/splitQuestion")
    @ResponseBody
    public JSONObject splitQuestion(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
        return sessionEntrance.withNewSession(param, sessionId -> {
            UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
            User user = SystemUtils.getCurUser();
            Boolean isV0 = param.getBoolean("isV0");
            if (isV0 == null) {
            	isV0 = true;
            }
            return chatService.splitQuestion(param.getString("question"), sessionId, param.getList("classNames", String.class), true, lang, curUserDataPermission, user, isV0);
        });
    }

    @PostMapping(path = "/streamSplitQuestion", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter postStreamSpliteQuestion(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
        UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
        User user = SystemUtils.getCurUser();
        String question = param.getString("question");
        List<String> classNames = param.getList("classNames", String.class);
        Boolean v0 = param.getBoolean("isV0");
        if (v0 == null) {
        	v0 = true;
        }
        final boolean isV0 = v0;
        return sessionEntrance.openNewSessionStream(param, "streamSplitQuestion", streamId -> {
            JSONObject response = chatService.splitQuestion(question, streamId, classNames, true, lang, curUserDataPermission, user, isV0);
            SseEmitterUtil.sendSseEmitter(streamId, JSON.toJSONString(response));
        });
    }

    @PostMapping("/abcHarness")
    @ResponseBody
    public SseEmitter abcHarness(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
        UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
        User user = SystemUtils.getCurUser();
        String question = param.getString("question");
        List<String> classNames = param.getList("classNames", String.class);
        return sessionEntrance.openNewSessionStream(param, "abcHarness", streamId -> {
            abcHarnessService.abcHarness(streamId, question, classNames, lang, curUserDataPermission, user);
        });
    }
    
    @PostMapping("/getMidSet")
    @ResponseBody
    public JSONArray getMidSet(@RequestBody JSONObject dsl) {
    	UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
    	User user = SystemUtils.getCurUser();
    	JSONArray response = chatService.getMidSet(dsl, curUserDataPermission, user.getDomainId());
        return response;
    }
    
    @GetMapping("/getABCTaskCountInQueue")
    @ResponseBody
    public JSONObject getTaskCountInQueue(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
    	JSONObject ret = new JSONObject();
		Integer count = chatService.getTaskCountInQueue();
		if (count >= 0) {
			ret.put("data", count);
			ret.put("success", true);
		} else {
			ret.put("message", langService.get(lang, "Abc.notInService"));
			ret.put("success", false);
		}
		return ret;
	}
    
}
