package io.ontomato.dataengine.controller;

import java.util.UUID;
import java.util.concurrent.Executors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.CheckServiceV2;
import io.ontomato.dataengine.util.SseEmitterUtil;

@RestController
public class CheckController {

	@Autowired
	private CheckService checkService;
	
	@Autowired
	private CheckServiceV2 checkServiceV2;
	
	@PostMapping(path = "/check/queryBySessionId", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter queryBySessionId(@RequestBody JSONObject param) {
		String sseId = UUID.randomUUID().toString();
    	SseEmitter sseEmitter = SseEmitterUtil.createSseEmitter(sseId);

        Executors.newSingleThreadExecutor().execute(() -> {
        	checkService.queryBySessionId(param.getString("sessionId"), sseId, null);
            SseEmitterUtil.closeSseEmitter(sseId);
        });
        return sseEmitter;
	}
	
	@PostMapping(path = "/check/queryBySessionId-v2", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter queryBySessionIdV2(@RequestBody JSONObject param) {
		String sseId = UUID.randomUUID().toString();
    	SseEmitter sseEmitter = SseEmitterUtil.createSseEmitter(sseId);

    	String sessionId = param.getString("sessionId");
        Executors.newSingleThreadExecutor().execute(() -> {
        	ABCHarnessCheck check = null;
        	while (true) {
        		if (BackendSessionEntrance.isCancelled(sessionId)) {
        			break;
        		}
        		check = checkServiceV2.queryBySessionId(sessionId);
        		if (check == null || check.getFinished()) {
        			break;
        		}
        	}
        	if (check != null) {
        		if (check.getProgramDescriptions() != null) {
        			for (ABCHarnessProgramDescription programDescription : check.getProgramDescriptions()) {
        				JSONObject toSseContent = new JSONObject();
						toSseContent.put("summary", programDescription.getSummary());
						toSseContent.put("meaning", programDescription.getMeaning());
						SseEmitterUtil.sendSseEmitter(sseId, JSON.toJSONString(toSseContent));
        			}
        			JSONObject toSseContent = new JSONObject();
					toSseContent.put("conclusion", check.getConclusion());
					toSseContent.put("score", check.getScore());
					toSseContent.put("fittedQuestion", check.getFittedQuestion());
					SseEmitterUtil.sendSseEmitter(sseId, JSON.toJSONString(toSseContent));
        		}
        	}
        	
            SseEmitterUtil.closeSseEmitter(sseId);
        });
        return sseEmitter;
	}
	
}
