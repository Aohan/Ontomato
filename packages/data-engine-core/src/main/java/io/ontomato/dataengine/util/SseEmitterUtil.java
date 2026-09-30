package io.ontomato.dataengine.util;

import java.util.Map;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
public class SseEmitterUtil {

    private static final Map<String, SseEmitter> SSE_CACHE = new ConcurrentHashMap<>();

    @FunctionalInterface
    private interface EmitterSend {
        void send(SseEmitter emitter) throws Exception;
    }
//    private static InheritableThreadLocal<String> tlSessionId = new InheritableThreadLocal<>();
    public static SseEmitter createSseEmitter(String sessionId) {
        SseEmitter sseEmitter = SSE_CACHE.get(sessionId);
        if (sseEmitter != null) {
            return sseEmitter;
        } else {
            SseEmitter sseEmitter_new = new SseEmitter(1800000L);
            log.info("Creating SSE connection. sessionId: " + sessionId);

            sseEmitter_new.onTimeout(() -> {
                log.warn("SSE connection timed out, preparing to close. sessionId: " + sessionId);
                SSE_CACHE.remove(sessionId);
            });

            sseEmitter_new.onCompletion(() -> {
                log.info("SSE connection closed, preparing to release. sessionId: " + sessionId);
                SSE_CACHE.remove(sessionId);
            });

            sseEmitter_new.onError(error -> {
                log.error("An error occurred on the SSE connection, preparing to release. sessionId: " + sessionId, error);
                SSE_CACHE.remove(sessionId);
            });

//            tlSessionId.set(sessionId);
            SSE_CACHE.put(sessionId, sseEmitter_new);
            return sseEmitter_new;
        }
    }

//    public static boolean sendSseEmitter(String message) {
//        String sessionId = tlSessionId.get();
//        if(sessionId!=null && !"".equals(sessionId)){
//            SseEmitter sseEmitter = SSE_CACHE.get(sessionId);
//            if (sseEmitter != null) {
//                try {
//                    sseEmitter.send(message);
//                    return true;
//                } catch (Exception e) {
//                    log.error("Failed to send SSE message, preparing to close the connection. sessionId: " + sessionId, e);
//                    sseEmitter.complete();
//                    return false;
//                }
//            }
//        }
////        log.warn("Failed to send SSE message, sessionId is empty or sseEmitter does not exist!");
//        return false;
//    }

    /**
     * The only send exit (confirmed design 9: the heartbeat is only responsible for sending and does not introduce any cancel or close behavior).
     * Normal messages and heartbeats share this one place: a failed send only returns false, does not break the stream and does not throw back to the business chain;
     * Stopping the heartbeat and writing the cancellation are handled by the heartbeat task at the entry point. Client disconnection is normal; failures are only logged at debug.
     */
    private static boolean send(String sessionId, EmitterSend action, String message) {
        SseEmitter sseEmitter = SSE_CACHE.get(sessionId);
        if (sseEmitter == null) {
        	log.info("SSE no longer exists. sessionId: " + sessionId + "    message: " + message);
        	return false;
        }
        try {
            action.send(sseEmitter);
            return true;
        } catch (Exception e) {
            log.debug("Failed to send SSE message. sessionId: " + sessionId, e);
            return false;
        }
    }

    public static boolean sendSseEmitter(String sessionId, String message) {
        boolean ok = send(sessionId, emitter -> emitter.send(message), message);
        if (ok) {
            log.info("SSE message sent successfully. sessionId: " + sessionId + "    message: " + message);
        }
        return ok;
    }

    public static void closeSseEmitter(String sessionId) {
//        String sessionId = tlSessionId.get();
        if(sessionId!=null && !"".equals(sessionId)){
            SseEmitter sseEmitter = SSE_CACHE.get(sessionId);
            if (sseEmitter != null){
                sseEmitter.complete();
            }
        }
    }

    /**
     * Send one heartbeat comment frame. It goes through the only send exit: a failure only returns false, and the entry point stops the heartbeat task of this session,
     * does not close the stream and does not throw back to the business chain.
     */
    public static boolean sendHeartbeat(String sessionId) {
        return send(sessionId, emitter -> emitter.send(SseEmitter.event().comment("heartbeat")), "heartbeat");
    }
}
