package io.ontomato.dataengine.service.ai;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.config.CustomRequestParameters;
import io.ontomato.dataengine.config.ModelConfig;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.http.client.HttpClient;
import dev.langchain4j.http.client.HttpMethod;
import dev.langchain4j.http.client.HttpRequest;
import dev.langchain4j.http.client.SuccessfulHttpResponse;
import dev.langchain4j.model.chat.Capability;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.openai.OpenAiChatModel;

class OpenAiCustomParametersRequestTest {

    private static final String CHAT_OK = "{"
            + "\"id\":\"chatcmpl-test\","
            + "\"object\":\"chat.completion\","
            + "\"created\":0,"
            + "\"model\":\"test-model\","
            + "\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"ok\"},\"finish_reason\":\"stop\"}],"
            + "\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}"
            + "}";

    private HttpServer server;
    private final AtomicReference<String> requestBody = new AtomicReference<>();
    private final AtomicReference<String> testHeader = new AtomicReference<>();
    private final List<String> requestBodies = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private final AtomicInteger requestCount = new AtomicInteger();
    private volatile int responseStatus = 200;
    private volatile String responseContentType = "application/json";
    private volatile String responsePayload = CHAT_OK;

    private static final ObjectMapper STRICT_JSON = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .build();

    private static void assertSingleJsonObject(String raw) {
        assertDoesNotThrow(() -> STRICT_JSON.readTree(raw));
    }

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requestCount.incrementAndGet();
            String captured = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requestBody.set(captured);
            requestBodies.add(captured);
            testHeader.set(exchange.getRequestHeaders().getFirst("X-Test"));
            byte[] response = responsePayload.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", responseContentType);
            exchange.sendResponseHeaders(responseStatus, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    }

    private OpenAiChatModel.OpenAiChatModelBuilder baseModelBuilder() {
        return OpenAiChatModel.builder()
                .baseUrl(baseUrl())
                .apiKey("test-key")
                .modelName("test-model");
    }

    @Test
    void createsChatServiceWithoutConditionalHttpClientBuilderBean() {
        assertDoesNotThrow(MultiThreadAIChatService::new);
    }

    @Test
    void overridesTopLevelBodyFieldsAtFinalExit() {
        Map<String, Object> overrides = new LinkedHashMap<>();
        overrides.put("model", "custom-model");
        overrides.put("temperature", 0.99);
        overrides.put("stream", true);
        overrides.put("max_tokens", 11);
        overrides.put("tools", List.of(Map.of("type", "function",
                "function", Map.of("name", "custom_tool"))));
        overrides.put("metadata", Map.of("source", "custom"));
        overrides.put("api_key", "body-key");
        overrides.put("base_url", "http://body-url/v1");
        overrides.put("nullable", null);
        overrides.put("large", "x".repeat(20 * 1024));
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(overrides)))
                .temperature(0.1)
                .build();

        assertEquals("ok", model.chat("hello"));

        assertSingleJsonObject(requestBody.get());
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals("custom-model", body.getString("model"));
        assertEquals(0.99, body.getDoubleValue("temperature"));
        assertEquals(true, body.getBooleanValue("stream"));
        assertEquals(11, body.getIntValue("max_tokens"));
        assertEquals(1, body.getJSONArray("tools").size());
        assertEquals("custom", body.getJSONObject("metadata").getString("source"));
        assertEquals("body-key", body.getString("api_key"));
        assertEquals("http://body-url/v1", body.getString("base_url"));
        assertTrue(body.containsKey("nullable"));
        assertEquals(20 * 1024, body.getString("large").length());
        assertFalse(body.containsKey("customRequestParameters"));
        assertFalse(body.containsKey("extra_body"));
        assertEquals(1, requestCount.get());
    }

    @Test
    void keepsSystemValuesForAbsentFields() {
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(Map.of("temperature", 0.5))))
                .temperature(0.1)
                .build();

        assertEquals("ok", model.chat("hello"));

        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals(0.5, body.getDoubleValue("temperature"));
        assertEquals("test-model", body.getString("model"));
        assertEquals("hello", body.getJSONArray("messages").getJSONObject(0).getString("content"));
    }

    @Test
    void customMessagesWinAfterAssistantCompletion() {
        List<Object> customMessages = List.of(
                Map.of("role", "user", "content", "custom question"),
                Map.of("role", "assistant", "reasoning_content", "custom thinking"));
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(Map.of("messages", customMessages))))
                .sendThinking(true)
                .build();

        model.chat(ChatRequest.builder()
                .messages(
                        UserMessage.from("question"),
                        AiMessage.builder().thinking("reasoning").build())
                .build());

        assertSingleJsonObject(requestBody.get());
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals(customMessages, body.getObject("messages", List.class));
        assertFalse(body.getJSONArray("messages").getJSONObject(1).containsKey("content"));
    }

    @Test
    void nullOverridesSystemGeneratedField() {
        Map<String, Object> overrides = new LinkedHashMap<>();
        overrides.put("temperature", null);
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(overrides)))
                .temperature(0.1)
                .build();

        assertEquals("ok", model.chat("hello"));

        assertSingleJsonObject(requestBody.get());
        JSONObject body = JSON.parseObject(requestBody.get());
        assertTrue(body.containsKey("temperature"));
        assertEquals(null, body.get("temperature"));
        assertEquals("test-model", body.getString("model"));
    }

    @Test
    void isolatesCustomParametersBetweenModelInstances() {
        OpenAiChatModel modelA = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(
                                Map.of("model", "model-a", "temperature", 0.1))))
                .build();
        OpenAiChatModel modelB = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(
                                Map.of("model", "model-b", "temperature", 0.9))))
                .build();

        assertEquals("ok", modelA.chat("hello"));
        assertEquals("model-a", JSON.parseObject(requestBody.get()).getString("model"));
        assertEquals("ok", modelB.chat("hello"));
        assertEquals("model-b", JSON.parseObject(requestBody.get()).getString("model"));
        assertEquals("ok", modelA.chat("hello"));
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals("model-a", body.getString("model"));
        assertEquals(0.1, body.getDoubleValue("temperature"));
    }

    @Test
    void replacesNestedObjectsAndArraysByWholeValue() {
        Map<String, Object> overrides = new LinkedHashMap<>();
        overrides.put("response_format", Map.of("type", "json_object"));
        overrides.put("stop", List.of("custom-stop"));
        overrides.put("nullable", null);
        HttpClient client = new OntomatoHttpClientBuilder(
                CustomRequestParameters.normalize(overrides)).build();
        String systemBody = "{"
                + "\"model\":\"test-model\","
                + "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],"
                + "\"response_format\":{\"type\":\"text\",\"pivot\":1},"
                + "\"stop\":[\"a\",\"b\"],"
                + "\"keep\":\"sys\"}";

        SuccessfulHttpResponse response = client.execute(HttpRequest.builder()
                .method(HttpMethod.POST)
                .url(baseUrl() + "/chat/completions")
                .headers(Map.of("Content-Type", List.of("application/json")))
                .body(systemBody)
                .build());

        assertEquals(200, response.statusCode());
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals(Map.of("type", "json_object"), body.getObject("response_format", Map.class));
        assertEquals(List.of("custom-stop"), body.getObject("stop", List.class));
        assertTrue(body.containsKey("nullable"));
        assertEquals("sys", body.getString("keep"));
        assertEquals("test-model", body.getString("model"));
    }

    @Test
    void incompatibleStreamOverrideSurfacesActualErrorWithoutCorrectiveRewrite() {
        responseContentType = "text/event-stream";
        responsePayload = "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\","
                + "\"created\":0,\"model\":\"test-model\","
                + "\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"},\"finish_reason\":null}]}\n\n"
                + "data: [DONE]\n\n";
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(
                        CustomRequestParameters.normalize(Map.of("stream", true))))
                .build();

        Exception error = assertThrows(Exception.class, () -> model.chat("hello"));

        assertFalse(requestBodies.isEmpty(), "incompatible request must actually be sent");
        for (String sent : requestBodies) {
            assertEquals(requestBodies.get(0), sent, "no corrective rewrite between attempts");
        }
        assertEquals(true, JSON.parseObject(requestBodies.get(0)).getBooleanValue("stream"));
        assertFalse(error instanceof UnsupportedOperationException,
                "stream:true must not route to the SSE overload");
        assertTrue(error.getMessage() != null && error.getMessage().contains("Unrecognized token"),
                "non-streaming parse error must surface, actual: " + error);
    }

    @Test
    void addsEmptyContentToAssistantMessages() {
        OpenAiChatModel model = baseModelBuilder()
                .httpClientBuilder(new OntomatoHttpClientBuilder(Map.of()))
                .sendThinking(true)
                .build();
        model.chat(ChatRequest.builder()
                .messages(
                        UserMessage.from("question"),
                        AiMessage.builder().thinking("reasoning").build())
                .build());

        JSONObject body = JSON.parseObject(requestBody.get());
        JSONObject assistant = body.getJSONArray("messages").getJSONObject(1);
        assertEquals("assistant", assistant.getString("role"));
        assertTrue(assistant.containsKey("content"));
        assertEquals("", assistant.getString("content"));
        assertEquals("reasoning", assistant.getString("reasoning_content"));
    }

    private ModelConfig productionModel() {
        ModelConfig model = new ModelConfig();
        model.setName("m");
        model.setBaseUrl(baseUrl());
        model.setApiKeys(new ArrayList<>(List.of("k")));
        model.setModelName("test-model");
        return model;
    }

    @Test
    void fullModelParametersReachRequestWithCustomWinning() {
        ModelConfig model = productionModel();
        model.setTemperature(0.5);
        model.setTopP(0.2);
        model.setStop(List.of("s1"));
        model.setMaxTokens(123);
        model.setMaxCompletionTokens(456);
        model.setPresencePenalty(0.1);
        model.setFrequencyPenalty(0.2);
        model.setLogitBias(Map.of("a", 1));
        model.setResponseFormat("json_object");
        model.setSupportedCapabilities(Set.of(Capability.RESPONSE_FORMAT_JSON_SCHEMA));
        model.setStrictJsonSchema(true);
        model.setSeed(7);
        model.setUser("u");
        model.setParallelToolCalls(false);
        model.setStore(true);
        model.setMetadata(Map.of("k", "v"));
        model.setServiceTier("tier");
        model.setReasoningEffort("low");
        model.setTimeout(Duration.ofSeconds(20));
        model.setMaxRetries(1);
        model.setLogRequests(false);
        model.setLogResponses(false);
        model.setCustomHeaders(Map.of("X-Test", "h"));
        Map<String, Object> custom = new LinkedHashMap<>();
        custom.put("temperature", 0.9);
        custom.put("extra", "x");
        model.setCustomRequestParameters(CustomRequestParameters.normalize(custom));

        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(model, true, 50000);

        assertEquals("ok", chatModel.chat(ChatRequest.builder()
                .messages(UserMessage.from("hello"))
                .toolSpecifications(ToolSpecification.builder()
                        .name("custom_tool")
                        .description("d")
                        .build())
                .build()).aiMessage().text());
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals(0.9, body.getDoubleValue("temperature"));
        assertEquals(0.2, body.getDoubleValue("top_p"));
        assertEquals(List.of("s1"), body.getObject("stop", List.class));
        assertEquals(123, body.getIntValue("max_tokens"));
        assertEquals(456, body.getIntValue("max_completion_tokens"));
        assertEquals(0.1, body.getDoubleValue("presence_penalty"));
        assertEquals(0.2, body.getDoubleValue("frequency_penalty"));
        assertEquals(Map.of("a", 1), body.getObject("logit_bias", Map.class));
        assertEquals(Map.of("type", "json_object"), body.getObject("response_format", Map.class));
        assertEquals(7, body.getIntValue("seed"));
        assertEquals("u", body.getString("user"));
        assertEquals(true, body.getJSONArray("tools").getJSONObject(0)
                .getJSONObject("function").getBooleanValue("strict"));
        assertEquals(false, body.getBooleanValue("parallel_tool_calls"));
        assertEquals(true, body.getBooleanValue("store"));
        assertEquals(Map.of("k", "v"), body.getObject("metadata", Map.class));
        assertEquals("tier", body.getString("service_tier"));
        assertEquals("low", body.getString("reasoning_effort"));
        assertEquals("x", body.getString("extra"));
        assertEquals("h", testHeader.get());
    }

    @Test
    void sparseFormalModelKeepsDefaultsAndOmitsUnset() {
        ModelConfig model = productionModel();
        model.setMaxTokens(50000);
        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(model, false, 50000);

        assertEquals("ok", chatModel.chat("hello"));
        JSONObject body = JSON.parseObject(requestBody.get());
        assertEquals(50000, body.getIntValue("max_tokens"));
        assertEquals(50000, body.getIntValue("max_completion_tokens"));
        assertEquals("test-model", body.getString("model"));
        assertFalse(body.containsKey("temperature"));
        assertFalse(body.containsKey("stop"));
    }

    @Test
    void sparseDraftModelKeepsSdkDefaults() {
        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(productionModel(), false, null);

        assertEquals("ok", chatModel.chat("hello"));
        JSONObject body = JSON.parseObject(requestBody.get());
        assertFalse(body.containsKey("max_tokens"));
        assertFalse(body.containsKey("max_completion_tokens"));
    }

    @Test
    void refLiteralPreservedAtFinalExit() {
        ModelConfig model = productionModel();
        model.setMaxTokens(50000);
        Map<String, Object> custom = new LinkedHashMap<>();
        custom.put("nested", Map.of("$ref", "$"));
        model.setCustomRequestParameters(CustomRequestParameters.normalize(custom));

        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(model, false, 50000);

        assertEquals("ok", chatModel.chat("hello"));
        assertSingleJsonObject(requestBody.get());
        JSONObject body = JSON.parseObject(requestBody.get(), JSONReader.Feature.DisableReferenceDetect);
        Object nested = body.get("nested");
        assertTrue(nested instanceof Map);
        assertNotSame(body, nested);
        assertEquals("$", ((Map<?, ?>) nested).get("$ref"));
    }
}
