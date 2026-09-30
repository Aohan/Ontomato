package io.ontomato.dataengine.logging;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.Content;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.listener.ChatModelErrorContext;
import dev.langchain4j.model.chat.listener.ChatModelListener;
import dev.langchain4j.model.chat.listener.ChatModelRequestContext;
import dev.langchain4j.model.chat.listener.ChatModelResponseContext;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.model.chat.response.ChatResponse;
import dev.langchain4j.model.chat.response.ChatResponseMetadata;
import dev.langchain4j.model.output.FinishReason;
import dev.langchain4j.model.output.TokenUsage;

public class AgentLlmCallListener implements ChatModelListener {

    private static final Logger log = LoggerFactory.getLogger(AgentLlmCallListener.class);
    private static final Logger agentLlmLog = LoggerFactory.getLogger("AGENT_LLM_LOG");

    private static final int MAX_TEXT_LENGTH = 100000;
    private static final String ATTR_STARTED_AT = AgentLlmCallListener.class.getName() + ".startedAt";
    private static final String ATTR_START_NANOS = AgentLlmCallListener.class.getName() + ".startNanos";
    private static final String ATTR_ROUND = AgentLlmCallListener.class.getName() + ".round";
    private static final String ATTR_AGENT_RUN_ID = AgentLlmCallListener.class.getName() + ".agentRunId";
    private static final String ATTR_SESSION_ID = AgentLlmCallListener.class.getName() + ".sessionId";
    private static final String ATTR_AGENT_NAME = AgentLlmCallListener.class.getName() + ".agentName";
    private static final String ATTR_DOMAIN_ID = AgentLlmCallListener.class.getName() + ".domainId";

    @Override
    public void onRequest(ChatModelRequestContext ctx) {
        try {
            AgentCallContext callContext = AgentCallContext.current();
            String sessionId = callContext == null ? null : callContext.getSessionId();
            String agentName = callContext == null || callContext.getAgentName() == null ? "unknown" : callContext.getAgentName();
            int round = callContext == null ? 1 : callContext.nextRound();
            String startedAt = Instant.now().toString();

            Map<Object, Object> attributes = ctx.attributes();
            attributes.put(ATTR_STARTED_AT, startedAt);
            attributes.put(ATTR_START_NANOS, System.nanoTime());
            attributes.put(ATTR_ROUND, round);
            attributes.put(ATTR_AGENT_RUN_ID, callContext == null ? null : callContext.getAgentRunId());
            attributes.put(ATTR_SESSION_ID, sessionId);
            attributes.put(ATTR_AGENT_NAME, agentName);
            attributes.put(ATTR_DOMAIN_ID, callContext == null ? null : callContext.getDomainId());
        } catch (Exception e) {
            log.debug("Failed to record agent LLM request context", e);
        }
    }

    @Override
    public void onResponse(ChatModelResponseContext ctx) {
        try {
            ChatResponse chatResponse = ctx.chatResponse();
            ChatResponseMetadata metadata = chatResponse == null ? null : chatResponse.metadata();
            FinishReason finishReason = metadata == null ? null : metadata.finishReason();

            JSONObject json = baseJson(ctx.chatRequest(), ctx.attributes(), "success");
            json.put("output", outputJson(chatResponse == null ? null : chatResponse.aiMessage(), finishReason));
            json.put("tokens", tokensJson(metadata == null ? null : metadata.tokenUsage()));
            agentLlmLog.info(json.toJSONString());
        } catch (Exception e) {
            log.debug("Failed to log agent LLM response", e);
        }
    }

    @Override
    public void onError(ChatModelErrorContext ctx) {
        try {
            JSONObject json = baseJson(ctx.chatRequest(), ctx.attributes(), "error");
            json.put("output", outputJson(null, null));
            json.put("tokens", tokensJson(null));
            json.put("error", errorText(ctx.error()));
            agentLlmLog.info(json.toJSONString());
        } catch (Exception e) {
            log.debug("Failed to log agent LLM error", e);
        }
    }

    JSONObject baseJson(ChatRequest chatRequest, Map<Object, Object> attributes, String status) {
        long ts = System.currentTimeMillis();
        String endedAt = Instant.ofEpochMilli(ts).toString();
        String startedAt = stringAttribute(attributes, ATTR_STARTED_AT, endedAt);
        Long startNanos = longAttribute(attributes, ATTR_START_NANOS);

        JSONObject json = new JSONObject();
        json.put("ts", ts);
        json.put("time", endedAt);
        json.put("agentRunId", stringAttribute(attributes, ATTR_AGENT_RUN_ID, null));
        json.put("sessionId", stringAttribute(attributes, ATTR_SESSION_ID, null));
        json.put("domainId", stringAttribute(attributes, ATTR_DOMAIN_ID, null));
        json.put("agentName", stringAttribute(attributes, ATTR_AGENT_NAME, "unknown"));
        json.put("round", intAttribute(attributes, ATTR_ROUND, 1));
        json.put("startedAt", startedAt);
        json.put("endedAt", endedAt);
        json.put("durationMs", startNanos == null ? 0L : (System.nanoTime() - startNanos) / 1000000L);
        json.put("status", status);
        json.put("model", modelName(chatRequest));
        json.put("messages", messagesJson(chatRequest));
        return json;
    }

    private String modelName(ChatRequest chatRequest) {
        if (chatRequest == null) {
            return null;
        }
        ChatRequestParameters parameters = chatRequest.parameters();
        if (parameters != null && parameters.modelName() != null) {
            return parameters.modelName();
        }
        return chatRequest.modelName();
    }

    private JSONArray messagesJson(ChatRequest chatRequest) {
        JSONArray messages = new JSONArray();
        if (chatRequest == null || chatRequest.messages() == null) {
            return messages;
        }
        for (ChatMessage message : chatRequest.messages()) {
            messages.add(messageJson(message));
        }
        return messages;
    }

    JSONObject messageJson(ChatMessage message) {
        JSONObject json = new JSONObject();
        if (message instanceof SystemMessage systemMessage) {
            json.put("role", "system");
            putText(json, systemMessage.text());
        } else if (message instanceof UserMessage userMessage) {
            json.put("role", "user");
            putText(json, userText(userMessage));
        } else if (message instanceof AiMessage aiMessage) {
            json.put("role", "assistant");
            putText(json, "reasoningContent", aiMessage.thinking());
            putText(json, aiMessage.text());
            json.put("toolCalls", toolCallsJson(aiMessage.toolExecutionRequests()));
        } else if (message instanceof ToolExecutionResultMessage toolMessage) {
            json.put("role", "tool");
            json.put("toolCallId", toolMessage.id());
            json.put("toolName", toolMessage.toolName());
            putText(json, toolText(toolMessage));
        } else {
            json.put("role", "unknown");
            json.put("type", message == null ? null : String.valueOf(message.type()));
            putText(json, message == null ? null : message.toString());
        }
        return json;
    }

    JSONObject outputJson(AiMessage aiMessage, FinishReason finishReason) {
        JSONObject output = new JSONObject();
        putText(output, "reasoningContent", aiMessage == null ? null : aiMessage.thinking());
        putText(output, aiMessage == null ? null : aiMessage.text());
        output.put("toolCalls", aiMessage == null ? new JSONArray() : toolCallsJson(aiMessage.toolExecutionRequests()));
        output.put("finishReason", finishReason == null ? null : finishReason.name());
        return output;
    }

    private JSONArray toolCallsJson(List<ToolExecutionRequest> requests) {
        JSONArray toolCalls = new JSONArray();
        if (requests == null) {
            return toolCalls;
        }
        for (ToolExecutionRequest request : requests) {
            JSONObject toolCall = new JSONObject();
            toolCall.put("id", request == null ? null : request.id());
            toolCall.put("name", request == null ? null : request.name());
            toolCall.put("arguments", request == null ? null : request.arguments());
            toolCalls.add(toolCall);
        }
        return toolCalls;
    }

    private JSONObject tokensJson(TokenUsage tokenUsage) {
        JSONObject tokens = new JSONObject();
        tokens.put("input", tokenUsage == null || tokenUsage.inputTokenCount() == null ? 0 : tokenUsage.inputTokenCount());
        tokens.put("output", tokenUsage == null || tokenUsage.outputTokenCount() == null ? 0 : tokenUsage.outputTokenCount());
        tokens.put("total", tokenUsage == null || tokenUsage.totalTokenCount() == null ? 0 : tokenUsage.totalTokenCount());
        return tokens;
    }

    private String userText(UserMessage userMessage) {
        if (userMessage.hasSingleText()) {
            return userMessage.singleText();
        }
        return contentsText(userMessage.contents());
    }

    private String toolText(ToolExecutionResultMessage toolMessage) {
        if (toolMessage.hasSingleText()) {
            return toolMessage.text();
        }
        return contentsText(toolMessage.contents());
    }

    private String contentsText(List<Content> contents) {
        if (contents == null || contents.isEmpty()) {
            return null;
        }
        StringBuilder text = new StringBuilder();
        for (Content content : contents) {
            if (text.length() > 0) {
                text.append('\n');
            }
            if (content instanceof TextContent textContent) {
                text.append(textContent.text());
            } else {
                text.append(content);
            }
        }
        return text.toString();
    }

    private void putText(JSONObject json, String text) {
        putText(json, "text", text);
    }

    private void putText(JSONObject json, String field, String text) {
        if (text != null && text.length() > MAX_TEXT_LENGTH) {
            json.put(field, text.substring(0, MAX_TEXT_LENGTH));
            json.put("truncated", true);
        } else {
            json.put(field, text);
        }
    }

    private String stringAttribute(Map<Object, Object> attributes, String key, String defaultValue) {
        if (attributes == null) {
            return defaultValue;
        }
        Object value = attributes.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    private Integer intAttribute(Map<Object, Object> attributes, String key, Integer defaultValue) {
        if (attributes == null) {
            return defaultValue;
        }
        Object value = attributes.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return defaultValue;
    }

    private Long longAttribute(Map<Object, Object> attributes, String key) {
        if (attributes == null) {
            return null;
        }
        Object value = attributes.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return null;
    }

    private String errorText(Throwable error) {
        if (error == null) {
            return null;
        }
        return error.toString();
    }
}
