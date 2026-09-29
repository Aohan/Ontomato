package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTaskMessage;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.logging.DiagnosticEventLogger;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.ABCHarnessService;
import io.ontomato.dataengine.service.ABCHarnessTaskService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.CheckServiceV2;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SseEmitterUtil;
import io.ontomato.dataengine.util.UserMessageUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ABCHarnessServiceImpl implements ABCHarnessService {

	@Autowired
    private AdminService adminService;

	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private ABCHarnessTaskService abcHarnessTaskService;

	@Autowired
	private CheckServiceV2 checkServiceV2;

	@Autowired
	private KnowledgeDao knowledgeDao;

	@Autowired
    private LangService langService;

	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Override
    public void abcHarness(String sessionId, String question, List<String> classNames, String lang, UserDataPermission curUserDataPermission, User user) {
    	long abcStart = System.currentTimeMillis();
        Thread agentThread = null;
        List<ABCHarnessProgram> programs = new ArrayList<>();
        String failure = null;
        boolean interrupted = false;
        boolean cancelled = false;
    	try {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException("ABC task cancelled");
    		DiagnosticEventLogger.emit("abc.program.started", sessionId, new JSONObject().fluentPut("question", question));
    		// Create task
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
    		abcHarnessTaskService.createTask(sessionId, timeoutMinutes, user.getId(), curUserDataPermission, lang);
			// Create quality check task
    		ABCHarnessCheck check = new ABCHarnessCheck();
    		check.setSessionId(sessionId);
    		check.setOriginQuestion(question);
    		check.setLang(lang);
    		check.setCreateTimestamp(System.currentTimeMillis());
    		check.setFinished(false);
    		checkServiceV2.saveCheckTask(check);

			// Completion/failure signal of the ABC programmer sub-thread: complete on success, carry the actual error on failure, no new message type is added
			CompletableFuture<Void> agentDone = new CompletableFuture<Void>();
    		// Call the ABC programmer
    		OriginalQuestion originalQuestion = new OriginalQuestion();
    		originalQuestion.setId(sessionId);
    		originalQuestion.setQuestion(question);
    		Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
    		String port = businessConfigService.getRuntimeWholeConfig(user.getDomainId()).getJSONObject("server").getInteger("port") + "";
    		String userMessage = UserMessageUtil.getAbcProgrammerUserMessage(
                    sessionId, question, port,
					knowledgeDao,
					businessConfig.getKnowledgeMaxResult(),
					lang, langService, classNames, jsonRule,
					adminService.getAbcProgrammerExample(user.getDomainId()), user.getDomainId());
            agentThread = new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String retStr = multiThreadAIChatService.chat(
								MultiThreadAIChatService.ABC_PROGRAMMER,
								originalQuestion,
								sessionId,
								userMessage,
								ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
								user.getDomainId());
						ABCHarnessTaskMessage message = new ABCHarnessTaskMessage();
						message.setSessionId(sessionId);
						message.setType(ABCHarnessTaskMessage.MESSAGE_TYPE);
						JSONObject content = new JSONObject();
						content.put("message", retStr);
						message.setContent(content);
						abcHarnessTaskService.pushMessage(message);
						agentDone.complete(null);
					} catch (Throwable e) {
						if (SessionCancelledException.findCancelled(e) != null) {
							log.info("[" + sessionId + "] abc programmer cancelled");
							agentDone.completeExceptionally(e);
							return;
						}
						log.error(e.getMessage(), e);
						agentDone.completeExceptionally(e);
					}
				}
            });
            agentThread.start();

	    	// Poll until all tasks finish, while emitting SSE
	    	while (true) {
	    		if (BackendSessionEntrance.isCancelled(sessionId)) {
	    			// Session cancelled: interrupt the programmer thread, finish with the existing interrupt cleanup, and do not send to the quality check.
	    			log.info("[" + sessionId + "] abcHarness cancelled, interrupt agent thread");
	    			if (agentThread != null && agentThread.isAlive()) {
	    				agentThread.interrupt();
	    			}
	    			cancelled = true;
	    			interrupted = true;
	    			break;
	    		}
	    		for (ABCHarnessTaskMessage message : abcHarnessTaskService.takeMessages(sessionId)) {
	    			JSONObject sseMessage = new JSONObject();
	    			sseMessage.put("type", message.getType());
	    			sseMessage.put("content", message.getContent());
	    			SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(sseMessage, Feature.WriteMapNullValue));
	    			if (ABCHarnessTaskMessage.DATA_TYPE.equals(message.getType())) {
	    				ABCHarnessProgram program = new ABCHarnessProgram();
	    				program.setQuestion(message.getContent().getString("question"));
	    				program.setCode(message.getContent().getString("code"));
	    				program.setOutKeyRefs(message.getContent().getJSONArray("outKeyRefs").toList(ABCHarnessProgramOutKeyRef.class));
	    				programs.add(program);
	    			}
	    		}
				Boolean flag = null;
				try {
					agentDone.get(1L, TimeUnit.SECONDS);
					flag = true;
				} catch (TimeoutException e) {
					// Sub-thread not finished: keep waiting along the existing one-second polling rhythm
				} catch (ExecutionException e) {
					// ABC programmer model failure: go into the existing failure and SSE error channel; if cancelled (on the chain or by flag), finish silently.
					Throwable cause = e.getCause() != null ? e.getCause() : e;
					if (SessionCancelledException.findCancelled(cause) != null
							|| BackendSessionEntrance.isCancelled(sessionId)) {
						log.info("[" + sessionId + "] abcHarness cancelled, stop without error frame");
						cancelled = true;
						interrupted = true;
						break;
					}
					failure = cause.toString();
					log.error(failure, e);
					JSONObject agentErrorMessage = new JSONObject();
					agentErrorMessage.put("error", failure);
					SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(agentErrorMessage, Feature.WriteMapNullValue));
					flag = true;
				}
	    		if (flag != null) {
		    		for (ABCHarnessTaskMessage message : abcHarnessTaskService.takeMessages(sessionId)) {
		    			JSONObject sseMessage = new JSONObject();
		    			sseMessage.put("type", message.getType());
		    			sseMessage.put("content", message.getContent());
		    			SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(sseMessage, Feature.WriteMapNullValue));
		    			if (ABCHarnessTaskMessage.DATA_TYPE.equals(message.getType())) {
		    				ABCHarnessProgram program = new ABCHarnessProgram();
		    				program.setQuestion(message.getContent().getString("question"));
		    				program.setCode(message.getContent().getString("code"));
		    				program.setOutKeyRefs(message.getContent().getJSONArray("outKeyRefs").toList(ABCHarnessProgramOutKeyRef.class));
		    				programs.add(program);
		    			}
		    		}
	    			break;
	    		} else {
	    			Thread.sleep(10000L);
	    		}
	    	}

	    	// Send to quality check: the quality check under a cancelled session stops, and it is only sent after a normal completion.
	    	if (!cancelled) checkServiceV2.check(check, programs, classNames, user.getDomainId());

	    } catch (Exception e) {
            failure = e.toString();
            interrupted = e instanceof InterruptedException;
    		log.error(e.getMessage(), e);
    		JSONObject errorMessage = new JSONObject();
    		errorMessage.put("error", e.getMessage());
    		SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(errorMessage, Feature.WriteMapNullValue));
        } finally {
            interrupted |= Thread.interrupted();
            if (agentThread != null && agentThread.isAlive()) {
                while (agentThread.isAlive()) {
                    agentThread.interrupt();
                    try { agentThread.join(100); }
                    catch (InterruptedException e) { interrupted = true; agentThread.interrupt(); }
                }
            }
            try {
                // On exception or cancellation, still keep the programs that have already been formally output but not yet consumed by polling.
                List<ABCHarnessTaskMessage> remaining = abcHarnessTaskService.takeMessages(sessionId);
                interrupted |= Thread.interrupted();
                if (remaining != null) {
                    for (ABCHarnessTaskMessage message : remaining) {
                        if (ABCHarnessTaskMessage.DATA_TYPE.equals(message.getType())) {
                            ABCHarnessProgram program = new ABCHarnessProgram();
                            program.setQuestion(message.getContent().getString("question"));
                            program.setCode(message.getContent().getString("code"));
                            program.setOutKeyRefs(message.getContent().getJSONArray("outKeyRefs").toList(ABCHarnessProgramOutKeyRef.class));
                            programs.add(program);
                        }
                    }
                }
                JSONObject abcFinished = new JSONObject();
                abcFinished.put("status", failure != null || interrupted || programs.isEmpty() ? "error" : "success");
                abcFinished.put("durationMs", System.currentTimeMillis() - abcStart);
                abcFinished.put("programs", buildProgramsPayload(programs));
                if (failure != null) abcFinished.put("error", new JSONObject().fluentPut("message", failure));
                DiagnosticEventLogger.emit("abc.program.finished", sessionId, abcFinished);
            } finally {
                abcHarnessTaskService.removeTask(sessionId);
                if (interrupted) Thread.currentThread().interrupt();
            }
    	}
    }

	private JSONArray buildProgramsPayload(List<ABCHarnessProgram> programs) {
		JSONArray arr = new JSONArray();
		if (programs == null) {
			return arr;
		}
		for (ABCHarnessProgram p : programs) {
			JSONObject po = new JSONObject();
			po.put("subQuestion", p.getQuestion());
			String code = p.getCode();
			if (code != null && code.length() > DiagnosticEventLogger.MAX_RESULT_BYTES) {
				po.put("code", code.substring(0, DiagnosticEventLogger.MAX_RESULT_BYTES));
				po.put("codeTruncated", true);
			} else {
				po.put("code", code);
				po.put("codeTruncated", false);
			}
			po.put("outKeyRefs", p.getOutKeyRefs());
			arr.add(po);
		}
		return arr;
	}

}
