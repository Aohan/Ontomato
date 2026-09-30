package io.ontomato.dataengine.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.config.ModelConfig;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;

class StrictToolsBranchTest {

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

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/chat/completions", exchange -> {
            byte[] bytes = exchange.getRequestBody().readAllBytes();
            requestBody.set(new String(bytes, StandardCharsets.UTF_8));
            byte[] response = CHAT_OK.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private ModelConfig testModel() {
        ModelConfig model = new ModelConfig();
        model.setName("test-model");
        model.setBaseUrl("http://localhost:" + server.getAddress().getPort());
        model.setApiKeys(new ArrayList<>(List.of("test-key")));
        model.setModelName("test-llm");
        model.setMaxTokens(50000);
        return model;
    }

    @Test
    void strictToolsTrueSetsStrictTrueOnTools() {
        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(testModel(), true, 50000);

        chatModel.chat(ChatRequest.builder()
                .messages(UserMessage.from("test"))
                .toolSpecifications(ToolSpecification.builder()
                        .name("my_tool")
                        .description("desc")
                        .build())
                .build());

        JSONObject body = JSON.parseObject(requestBody.get());
        assertTrue(body.containsKey("tools"));
        JSONObject tool = body.getJSONArray("tools").getJSONObject(0);
        assertTrue(tool.getJSONObject("function").getBooleanValue("strict"));
    }

    @Test
    void strictToolsFalseSetsStrictFalseOnTools() {
        ChatModel chatModel = MultiThreadAIChatService.buildChatModel(testModel(), false, 50000);

        chatModel.chat(ChatRequest.builder()
                .messages(UserMessage.from("test"))
                .toolSpecifications(ToolSpecification.builder()
                        .name("my_tool")
                        .description("desc")
                        .build())
                .build());

        JSONObject body = JSON.parseObject(requestBody.get());
        assertTrue(body.containsKey("tools"));
        JSONObject tool = body.getJSONArray("tools").getJSONObject(0);
        assertFalse(tool.getJSONObject("function").getBooleanValue("strict"));
    }
}
