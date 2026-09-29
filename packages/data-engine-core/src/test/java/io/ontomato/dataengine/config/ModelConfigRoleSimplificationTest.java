package io.ontomato.dataengine.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class ModelConfigRoleSimplificationTest {

    @Test
    void emptySeedIsReadableAndValid() {
        ModelDefaultsProperties defaults = new ModelDefaultsProperties();
        AgentConfig codingTmpl = new AgentConfig();
        codingTmpl.setSkilldir("");
        defaults.getAgents().put(AgentRole.CODING, codingTmpl);

        EmbeddingModelProperties emb = new EmbeddingModelProperties();
        DataRagConfig dataRagConfig = new DataRagConfig();

        BusinessConfig config = BusinessConfig.from(defaults, emb, dataRagConfig);

        assertNotNull(config.getModels());
        assertTrue(config.getModels().isEmpty());
        assertNotNull(config.getAgents());
        assertEquals(5, config.getAgents().size());
        assertEquals(AgentRole.ALL, config.getAgents().keySet());

        for (String role : AgentRole.ALL) {
            AgentConfig agent = config.getAgents().get(role);
            assertNotNull(agent);
            assertNull(agent.getModel(), "Role " + role + " model should be null in empty seed");
            if (AgentRole.CODING.equals(role)) {
                assertEquals("", agent.getSkilldir());
            } else {
                assertNull(agent.getSkilldir());
            }
        }

        assertDoesNotThrow(() -> ModelResolver.validateForSave(config));
        assertDoesNotThrow(() -> ModelResolver.normalizeForRead(config.getModels()));
    }

    @Test
    void completeSeedCreatesDefaultModelAndAssignsAllFiveRoles() {
        ModelDefaultsProperties defaults = new ModelDefaultsProperties();
        ModelConfig seedModel = new ModelConfig();
        seedModel.setName("default");
        seedModel.setBaseUrl("http://localhost:8000/v1");
        seedModel.setApiKeys(List.of("sk-test"));
        seedModel.setModelName("gpt-4o");
        defaults.getModels().add(seedModel);

        AgentConfig codingTmpl = new AgentConfig();
        codingTmpl.setSkilldir("/path/to/skills");
        defaults.getAgents().put(AgentRole.CODING, codingTmpl);

        EmbeddingModelProperties emb = new EmbeddingModelProperties();
        DataRagConfig dataRagConfig = new DataRagConfig();

        BusinessConfig config = BusinessConfig.from(defaults, emb, dataRagConfig);

        assertEquals(1, config.getModels().size());
        assertEquals("default", config.getModels().get(0).getName());
        assertEquals("gpt-4o", config.getModels().get(0).getModelName());

        assertEquals(5, config.getAgents().size());
        for (String role : AgentRole.ALL) {
            assertEquals("default", config.getAgents().get(role).getModel());
        }
        assertEquals("/path/to/skills", config.getAgents().get(AgentRole.CODING).getSkilldir());

        assertDoesNotThrow(() -> ModelResolver.validateForSave(config));
    }

    @Test
    void unassignedRoleThrowsExplicitRuntimeError() {
        BusinessConfig config = new BusinessConfig();
        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        for (String role : AgentRole.ALL) {
            AgentConfig agent = new AgentConfig();
            agent.setModel(null);
            agents.put(role, agent);
        }
        config.setAgents(agents);

        // Chinese default
        IllegalStateException queryEx = assertThrows(
                IllegalStateException.class,
                () -> ModelResolver.resolve(config, AgentRole.QUERY));
        assertEquals("角色『问数』未配置模型，请在模型配置中选择", queryEx.getMessage());

        IllegalStateException codingEx = assertThrows(
                IllegalStateException.class,
                () -> ModelResolver.resolve(config, AgentRole.CODING));
        assertEquals("角色『代码与计算』未配置模型，请在模型配置中选择", codingEx.getMessage());

        // English when config.lang is "en"
        config.setLang("en");
        IllegalStateException queryExEn = assertThrows(
                IllegalStateException.class,
                () -> ModelResolver.resolve(config, AgentRole.QUERY));
        assertEquals("No model is configured for role \"Query\". Choose one in Model Configuration.", queryExEn.getMessage());

        IllegalStateException codingExEn = assertThrows(
                IllegalStateException.class,
                () -> ModelResolver.resolve(config, AgentRole.CODING));
        assertEquals("No model is configured for role \"Coding and Computing\". Choose one in Model Configuration.", codingExEn.getMessage());
    }

    @Test
    void hasCompleteConnectionValidatesConnectionTriad() {
        ModelConfig m = new ModelConfig();
        org.junit.jupiter.api.Assertions.assertFalse(ModelResolver.hasCompleteConnection(m));
        m.setBaseUrl("http://localhost:8000/v1");
        org.junit.jupiter.api.Assertions.assertFalse(ModelResolver.hasCompleteConnection(m));
        m.setApiKeys(List.of("   "));
        org.junit.jupiter.api.Assertions.assertFalse(ModelResolver.hasCompleteConnection(m));
        m.setApiKeys(List.of("sk-key"));
        org.junit.jupiter.api.Assertions.assertFalse(ModelResolver.hasCompleteConnection(m));
        m.setModelName("model-test");
        assertTrue(ModelResolver.hasCompleteConnection(m));
    }

    @Test
    void assignedNonExistentModelThrowsError() {
        BusinessConfig config = new BusinessConfig();
        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        AgentConfig agent = new AgentConfig();
        agent.setModel("non-existent-model");
        agents.put(AgentRole.QUERY, agent);
        config.setAgents(agents);

        IllegalStateException ex = assertThrows(
                IllegalStateException.class,
                () -> ModelResolver.resolve(config, AgentRole.QUERY));
        assertTrue(ex.getMessage().contains("Model referenced by role query does not exist: non-existent-model"));
    }

    @Test
    void atomicSaveValidationAllowsEmptyRoleAndRejectsBadState() {
        BusinessConfig config = new BusinessConfig();
        ModelConfig m1 = new ModelConfig();
        m1.setName("m1");
        m1.setBaseUrl("http://localhost:8000/v1");
        m1.setApiKeys(List.of("k1"));
        m1.setModelName("test-m1");
        config.setModels(new ArrayList<>(List.of(m1)));

        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        for (String role : AgentRole.ALL) {
            AgentConfig a = new AgentConfig();
            a.setModel(null);
            agents.put(role, a);
        }
        config.setAgents(agents);

        // Allows role with null/blank model
        assertDoesNotThrow(() -> ModelResolver.validateForSave(config));

        // Rejects role referencing nonexistent model
        agents.get(AgentRole.QUERY).setModel("missing-model");
        IllegalArgumentException missingEx = assertThrows(
                IllegalArgumentException.class,
                () -> ModelResolver.validateForSave(config));
        assertTrue(missingEx.getMessage().contains("Model referenced by role query does not exist: missing-model"));

        // Rejects missing role
        agents.remove(AgentRole.QUERY);
        IllegalArgumentException missingRoleEx = assertThrows(
                IllegalArgumentException.class,
                () -> ModelResolver.validateForSave(config));
        assertTrue(missingRoleEx.getMessage().contains("Missing role configuration: query"));

        // Restore role
        AgentConfig validAgent = new AgentConfig();
        validAgent.setModel("m1");
        agents.put(AgentRole.QUERY, validAgent);

        // Rejects duplicate model name
        ModelConfig m1Duplicate = new ModelConfig();
        m1Duplicate.setName("m1");
        m1Duplicate.setBaseUrl("http://localhost:8000/v1");
        m1Duplicate.setApiKeys(List.of("k2"));
        m1Duplicate.setModelName("test-m2");
        config.getModels().add(m1Duplicate);
        assertThrows(IllegalArgumentException.class, () -> ModelResolver.validateForSave(config));

        // Rejects empty model name
        config.getModels().remove(1);
        m1.setName("");
        assertThrows(IllegalArgumentException.class, () -> ModelResolver.validateForSave(config));
        m1.setName("m1");

        // Rejects missing baseUrl
        m1.setBaseUrl("");
        assertThrows(IllegalArgumentException.class, () -> ModelResolver.validateForSave(config));
        m1.setBaseUrl("http://localhost:8000/v1");

        // Rejects empty apiKeys
        m1.setApiKeys(List.of(""));
        assertThrows(IllegalArgumentException.class, () -> ModelResolver.validateForSave(config));
        m1.setApiKeys(List.of("k1"));

        // Rejects empty modelName
        m1.setModelName("  ");
        assertThrows(IllegalArgumentException.class, () -> ModelResolver.validateForSave(config));
    }

    @Test
    void normalizeForReadAppliesDefaults() {
        ModelConfig m = new ModelConfig();
        m.setName("m1");
        m.setBaseUrl("http://localhost:8000/v1");
        m.setApiKeys(null);
        m.setModelName("gpt-4o");
        m.setMaxTokens(null);
        m.setContextWindow(null);
        m.setDisplayName(null);

        ModelResolver.normalizeForRead(List.of(m));

        assertEquals(50000, m.getMaxTokens());
        assertEquals(256000, m.getContextWindow());
        assertEquals("m1", m.getDisplayName());
        assertNotNull(m.getApiKeys());
        assertTrue(m.getApiKeys().isEmpty());

        // Preserves custom values
        ModelConfig m2 = new ModelConfig();
        m2.setName("m2");
        m2.setDisplayName("Custom M2");
        m2.setMaxTokens(8192);
        m2.setContextWindow(128000);
        m2.setApiKeys(List.of("key"));

        ModelResolver.normalizeForRead(List.of(m2));

        assertEquals(8192, m2.getMaxTokens());
        assertEquals(128000, m2.getContextWindow());
        assertEquals("Custom M2", m2.getDisplayName());
        assertEquals(List.of("key"), m2.getApiKeys());
    }
}
