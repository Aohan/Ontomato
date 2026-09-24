package io.ontomato.dataengine.logging;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.SessionRegistryService;

import jakarta.annotation.PostConstruct;

/**
 * Structured diagnostic event writer: one JSON line per event, written to logger {@code DIAGNOSTIC_EVENT_LOG}
 * (dedicated appender {@code diagnostic-events.jsonl}).
 *
 * <p>Wrapped in try-catch throughout; a write failure is never thrown back into the business flow. emit is a static method for unified use by Spring beans and non-beans
 * (e.g. {@code ABCDslSubQueryExecutor}); nodeId is captured into a static field by the container after startup.
 *
 * <p>Fixed fields of the base record: {@code time / ts / nodeId / sessionId / eventType / source / payload}.
 * Only one query key is kept, {@code sessionId} (session level=base, sub-query level=base-{index}); no eventId/queryId/level/subQueryIndex.
 */
@Component
public class DiagnosticEventLogger {

	public static final String SOURCE = "datarag";

	/** When the serialized result.json of m3.query.succeeded exceeds this byte count, only the answer details are omitted */
	public static final int MAX_RESULT_BYTES = 256 * 1024;

	private static final Logger log = LoggerFactory.getLogger(DiagnosticEventLogger.class);
	private static final Logger diagLog = LoggerFactory.getLogger("DIAGNOSTIC_EVENT_LOG");

	private static volatile SessionRegistryService sessionRegistryService;

	@Autowired
	private SessionRegistryService sessionRegistryServiceBean;

	@PostConstruct
	public void init() {
		sessionRegistryService = sessionRegistryServiceBean;
	}

	/**
	 * Write one diagnostic event. For session-level events sessionId=base; for sub-query-level events sessionId=base-{index}. payload may be null.
	 */
	public static void emit(String eventType, String sessionId, JSONObject payload) {
		try {
			long ts = System.currentTimeMillis();
			AgentCallContext context = AgentCallContext.current();
			JSONObject event = new JSONObject();
			event.put("time", OffsetDateTime.ofInstant(Instant.ofEpochMilli(ts), ZoneId.systemDefault()).toString());
			event.put("ts", ts);
			event.put("nodeId", sessionRegistryService == null ? null : sessionRegistryService.getNodeId());
			event.put("sessionId", sessionId);
			event.put("domainId", context == null ? null : context.getDomainId());
			event.put("eventType", eventType);
			event.put("source", SOURCE);
			event.put("payload", payload == null ? new JSONObject() : payload);
			diagLog.info(event.toJSONString());
		} catch (Exception e) {
			log.debug("Emit diagnostic event failed. eventType: {}, sessionId: {}", eventType, sessionId, e);
		}
	}

	/**
	 * Shape the M3 result into the result payload of m3.query.succeeded:
	 * <pre>{ "json": &lt;M3 JSON&gt;, "rowCount": n, "answerOmitted": bool, "truncated": bool }</pre>
	 * By default the full JSON is kept; when serialization exceeds {@link #MAX_RESULT_BYTES}, only the individual {@code "answer"} arrays are emptied
	 * (recording rowCount), while the rest of the structure and fields are kept as-is and are not turned into non-JSON text.
	 */
	public static JSONObject buildM3Result(Object m3Result) {
		JSONObject result = new JSONObject();
		try {
			Object node = JSON.parse(JSON.toJSONString(m3Result));
			long[] rowCounter = new long[] { 0L };
			countAnswers(node, rowCounter);
			boolean answerOmitted = false;
			boolean truncated = false;
			if (JSON.toJSONString(node).getBytes(StandardCharsets.UTF_8).length > MAX_RESULT_BYTES) {
				omitAnswers(node);
				answerOmitted = true;
				if (JSON.toJSONString(node).getBytes(StandardCharsets.UTF_8).length > MAX_RESULT_BYTES) {
					truncated = true;
				}
			}
			result.put("json", node);
			result.put("rowCount", rowCounter[0]);
			result.put("answerOmitted", answerOmitted);
			result.put("truncated", truncated);
		} catch (Exception e) {
			log.debug("Build m3 result payload failed", e);
			result.put("json", null);
			result.put("rowCount", 0);
			result.put("answerOmitted", false);
			result.put("truncated", false);
			result.put("error", "build result failed: " + e.getMessage());
		}
		return result;
	}

	/** Safely convert a DSL/query JSON string into structured JSON; if parsing fails, return the string as-is and never throw an exception. */
	public static Object safeJson(String s) {
		if (s == null) {
			return null;
		}
		try {
			return JSON.parse(s);
		} catch (Exception e) {
			return s;
		}
	}

	private static void countAnswers(Object node, long[] counter) {
		if (node instanceof JSONObject obj) {
			for (Map.Entry<String, Object> entry : obj.entrySet()) {
				if ("answer".equals(entry.getKey()) && entry.getValue() instanceof JSONArray arr) {
					counter[0] += arr.size();
				}
				countAnswers(entry.getValue(), counter);
			}
		} else if (node instanceof JSONArray arr) {
			for (Object item : arr) {
				countAnswers(item, counter);
			}
		}
	}

	private static void omitAnswers(Object node) {
		if (node instanceof JSONObject obj) {
			for (Map.Entry<String, Object> entry : obj.entrySet()) {
				if ("answer".equals(entry.getKey()) && entry.getValue() instanceof JSONArray) {
					entry.setValue(new JSONArray());
				} else {
					omitAnswers(entry.getValue());
				}
			}
		} else if (node instanceof JSONArray arr) {
			for (Object item : arr) {
				omitAnswers(item);
			}
		}
	}
}
