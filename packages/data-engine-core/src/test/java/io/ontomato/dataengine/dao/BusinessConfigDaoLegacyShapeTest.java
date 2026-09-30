package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

class BusinessConfigDaoLegacyShapeTest {

    private static final String[] LEGACY_ROLES = {
            "normalChat", "questionSpliter", "cleverNormalChat", "pythonChat", "toolChat"
    };

    @Test
    void rejectsLegacyRoleKeys() {
        for (String legacyRole : LEGACY_ROLES) {
            JSONObject stored = createValidStored();
            stored.getJSONObject("agents").put(legacyRole, new JSONObject());

            IllegalStateException ex = assertThrows(
                    IllegalStateException.class,
                    () -> BusinessConfigDao.rejectLegacyShapes(stored, "test-domain"));
            assertTrue(ex.getMessage().contains("contains legacy role key " + legacyRole));
        }
    }

    @Test
    void rejectsActorCopiesInRole() {
        JSONObject stored = createValidStored();
        JSONObject queryAgent = stored.getJSONObject("agents").getJSONObject("query");
        queryAgent.put("actorCopies", 5);

        IllegalStateException ex = assertThrows(
                IllegalStateException.class,
                () -> BusinessConfigDao.rejectLegacyShapes(stored, "test-domain"));
        assertTrue(ex.getMessage().contains("contains legacy agent parameter actorCopies in role query"));
    }

    @Test
    void rejectsStrictToolsOnModel() {
        for (String field : List.of("strictTools", "strict_tools", "strict-tools")) {
            JSONObject stored = createValidStored();
            stored.getJSONArray("models").getJSONObject(0).put(field, true);

            IllegalStateException ex = assertThrows(
                    IllegalStateException.class,
                    () -> BusinessConfigDao.rejectLegacyShapes(stored, "test-domain"));
            assertTrue(ex.getMessage().contains("contains legacy model parameter strictTools"));
        }
    }

    @Test
    void rejectsLegacyModelFieldsInRole() {
        JSONObject stored = createValidStored();
        JSONObject queryAgent = stored.getJSONObject("agents").getJSONObject("query");
        queryAgent.put("temperature", 0.7);

        IllegalStateException ex = assertThrows(
                IllegalStateException.class,
                () -> BusinessConfigDao.rejectLegacyShapes(stored, "test-domain"));
        assertTrue(ex.getMessage().contains("still contains role-side model parameters (temperature in role query)"));
    }

    @Test
    void validNewShapePasses() {
        JSONObject stored = createValidStored();
        assertDoesNotThrow(() -> BusinessConfigDao.rejectLegacyShapes(stored, "test-domain"));
    }

    private JSONObject createValidStored() {
        JSONObject stored = new JSONObject();
        JSONArray models = new JSONArray();
        JSONObject model = new JSONObject();
        model.put("name", "m1");
        model.put("baseUrl", "http://localhost:8000/v1");
        model.put("apiKeys", List.of("key1"));
        model.put("modelName", "gpt-4o");
        model.put("maxTokens", 50000);
        model.put("contextWindow", 256000);
        models.add(model);
        stored.put("models", models);

        JSONObject agents = new JSONObject();
        for (String role : List.of("query", "coding", "general", "diagnosis", "knowledgeGovernance")) {
            JSONObject agent = new JSONObject();
            agent.put("model", "m1");
            if ("coding".equals(role)) {
                agent.put("skilldir", "");
            }
            agents.put(role, agent);
        }
        stored.put("agents", agents);
        return stored;
    }
}
