package io.ontomato.dataengine.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;

class CustomRequestParametersTest {

    private static final ObjectMapper JSON_DOC = JsonMapper.builder().build();

    @Test
    void preservesAndCopiesNestedJson() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("enable_thinking", false);
        nested.put("budget", null);
        Map<String, Object> input = Map.of(
                "chat_template_kwargs", nested,
                "values", List.of("a", 2, true));

        Map<String, Object> normalized = CustomRequestParameters.normalize(input);

        assertEquals(input, normalized);
        assertNotSame(input, normalized);
        assertNotSame(nested, normalized.get("chat_template_kwargs"));
    }

    @Test
    void rejectsMissingAndNonObject() {
        assertThrows(
                IllegalArgumentException.class,
                () -> CustomRequestParameters.normalize(null));
        assertThrows(
                IllegalArgumentException.class,
                () -> CustomRequestParameters.normalize(List.of("not-an-object")));
    }

    @Test
    void allowsAllBodyFieldsWithoutSizeLimit() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("model", "custom-model");
        input.put("messages", List.of(Map.of("role", "user", "content", "hi")));
        input.put("stream", true);
        input.put("tools", List.of(Map.of("type", "function")));
        input.put("temperature", 0.9);
        input.put("max_tokens", 11);
        input.put("api_key", "body-key");
        input.put("base_url", "http://body-url/v1");
        input.put("provider", Map.of("apiKey", "nested-value"));
        input.put("__proto__", true);
        input.put("nullable", null);
        input.put("large", "x".repeat(64 * 1024));

        Map<String, Object> normalized = CustomRequestParameters.normalize(input);

        JsonNode expected = assertDoesNotThrow(
                () -> JSON_DOC.readTree(JSON.toJSONString(input, JSONWriter.Feature.WriteMapNullValue)));
        JsonNode actual = assertDoesNotThrow(
                () -> JSON_DOC.readTree(JSON.toJSONString(normalized, JSONWriter.Feature.WriteMapNullValue)));
        assertEquals(expected, actual);
        assertTrue(normalized.containsKey("nullable"));
        assertEquals(64 * 1024, ((String) normalized.get("large")).length());
    }

    @Test
    void refLiteralsPreservedWithoutCycles() {
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("$ref", "$");
        Map<String, Object> normalized = CustomRequestParameters.normalize(Map.of("nested", inner));

        Object nested = normalized.get("nested");
        assertTrue(nested instanceof Map);
        assertEquals("$", ((Map<?, ?>) nested).get("$ref"));
        assertNotSame(normalized, nested);
    }

    @Test
    void copyIsDetachedFromInput() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("a", 1);
        List<Object> items = new ArrayList<>(List.of("x"));
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("nested", nested);
        input.put("items", items);

        Map<String, Object> normalized = CustomRequestParameters.normalize(input);
        nested.put("a", 2);
        items.add("y");

        assertEquals(Map.of("a", 1), normalized.get("nested"));
        assertEquals(List.of("x"), normalized.get("items"));
    }
}
