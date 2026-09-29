package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.AgentConfig;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerModelSettingsTest {

    private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
    private final BusinessConfigController controller = new BusinessConfigController();
    private BusinessConfig stored;

    @BeforeEach
    void setUp() {
        User user = mock(User.class);
        when(user.getDomainId()).thenReturn("d1");
        IdentityService identityService = mock(IdentityService.class);
        when(identityService.getCurrentUser()).thenReturn(user);
        GenericApplicationContext context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identityService);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);

        stored = new BusinessConfig();
        ModelConfig m1 = new ModelConfig();
        m1.setName("default");
        m1.setBaseUrl("http://localhost:8000/v1");
        m1.setApiKeys(new ArrayList<>(List.of("sk-test")));
        m1.setModelName("gpt-4o");
        stored.setModels(new ArrayList<>(List.of(m1)));

        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        for (String role : AgentRole.ALL) {
            AgentConfig agent = new AgentConfig();
            agent.setModel("default");
            if (AgentRole.CODING.equals(role)) {
                agent.setSkilldir("/path/to/skills");
            }
            agents.put(role, agent);
        }
        stored.setAgents(agents);

        when(businessConfigService.get("d1")).thenReturn(stored);
        ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
    }

    @Test
    void getModelSettingsReturnsNormalizedModelsAndAgents() {
        JSONObject response = controller.getModelSettings();
        assertTrue(response.getBooleanValue("success"));
        JSONObject data = response.getJSONObject("data");
        assertNotNull(data);

        JSONArray models = data.getJSONArray("models");
        assertEquals(1, models.size());
        assertEquals("default", models.getJSONObject(0).getString("name"));
        assertEquals(50000, models.getJSONObject(0).getIntValue("maxTokens"));
        assertEquals(256000, models.getJSONObject(0).getIntValue("contextWindow"));

        JSONObject agents = data.getJSONObject("agents");
        assertEquals(5, agents.size());
        for (String role : AgentRole.ALL) {
            assertTrue(agents.containsKey(role));
            assertEquals("default", agents.getJSONObject(role).getString("model"));
        }
        assertEquals("/path/to/skills", agents.getJSONObject("coding").getString("skilldir"));
    }

    @Test
    void saveModelSettingsPreservesSkilldirAndSavesAtomically() {
        JSONObject input = new JSONObject();
        JSONArray models = new JSONArray();
        JSONObject m = new JSONObject();
        m.put("name", "new-model");
        m.put("baseUrl", "http://localhost:8000/v1");
        m.put("apiKeys", List.of("key1"));
        m.put("modelName", "gpt-4o-mini");
        models.add(m);
        input.put("models", models);

        JSONObject agents = new JSONObject();
        for (String role : AgentRole.ALL) {
            agents.put(role, "new-model");
        }
        input.put("agents", agents);

        JSONObject response = controller.saveModelSettings(input);
        assertTrue(response.getBooleanValue("success"));

        ArgumentCaptor<BusinessConfig> captor = ArgumentCaptor.forClass(BusinessConfig.class);
        verify(businessConfigService).set(captor.capture(), eq("d1"));

        BusinessConfig saved = captor.getValue();
        assertEquals(1, saved.getModels().size());
        assertEquals("new-model", saved.getModels().get(0).getName());
        assertEquals("/path/to/skills", saved.getAgents().get(AgentRole.CODING).getSkilldir());
        assertEquals("new-model", saved.getAgents().get(AgentRole.QUERY).getModel());
    }

    @Test
    void saveModelSettingsRejectsMissingRole() {
        JSONObject input = new JSONObject();
        input.put("models", new JSONArray());
        JSONObject agents = new JSONObject();
        agents.put("query", null);
        input.put("agents", agents);

        JSONObject response = controller.saveModelSettings(input);
        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("agents must contain all five roles"));
    }

    @Test
    void saveModelSettingsAllowsNullRoleModel() {
        JSONObject input = new JSONObject();
        input.put("models", new JSONArray());
        JSONObject agents = new JSONObject();
        for (String role : AgentRole.ALL) {
            agents.put(role, null);
        }
        input.put("agents", agents);

        JSONObject response = controller.saveModelSettings(input);
        assertTrue(response.getBooleanValue("success"));
    }

    @Test
    void saveToolSkillDirWritesToCodingRole() {
        JSONObject input = new JSONObject();
        input.put("skilldir", "/custom/skills");

        JSONObject response = controller.saveToolSkillDir(input);
        assertTrue(response.getBooleanValue("success"));

        assertEquals("/custom/skills", stored.getAgents().get(AgentRole.CODING).getSkilldir());
        verify(businessConfigService).set(stored, "d1");
    }
}
