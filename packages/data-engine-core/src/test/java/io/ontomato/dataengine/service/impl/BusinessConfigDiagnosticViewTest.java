package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.config.AgentConfig;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.controller.BusinessConfigController;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.BusinessConfigDao;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * getConfigAndDesc's diagnosis view over HTTP: named non-secret fields only. The response is serialized as the app does
 * (Spring Boot's Jackson defaults: nulls written, durations as ISO text) and must equal the shared samples that the
 * workbench server's contract schema parses unchanged (packages/contracts/src/__tests__/fixtures).
 */
class BusinessConfigDiagnosticViewTest {

    private static final Path FIXTURES = Path.of("../contracts/src/__tests__/fixtures");
    /** The cache directory is the process's absolute path; the samples carry this fixed value instead. */
    private static final String SAMPLE_CACHE_DIR = "/srv/datarag/conf/subQueryCache";

    private static final ObjectMapper BOOT_JSON = Jackson2ObjectMapperBuilder.json()
            .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS,
                    SerializationFeature.WRITE_DURATIONS_AS_TIMESTAMPS)
            .build();

    @Test
    void aConfigWithSecretsEverywhereGivesTheFullSampleAndNoSecret() throws Exception {
        ModelConfig model = new ModelConfig();
        model.setName("main");
        model.setDisplayName("Main");
        model.setBaseUrl("https://user:SECRET-URL-USERINFO@llm.test/SECRET-URL-PATH/v1?key=SECRET-URL-QUERY");
        model.setApiKeys(new ArrayList<>(List.of("SECRET-MODEL-KEY")));
        model.setModelName("api-main");
        model.setTimeout(Duration.ofSeconds(90));
        model.setMaxRetries(2);
        model.setMaxTokens(4000);
        model.setContextWindow(64000);
        model.setOrganizationId("SECRET-ORG");
        model.setUser("SECRET-USER");
        model.setCustomHeaders(Map.of("Authorization", "Bearer SECRET-HEADER"));
        model.setCustomRequestParameters(new LinkedHashMap<>(Map.of("nested", Map.of("token", "SECRET-PARAM"))));
        BusinessConfig config = config(List.of(model), "main");
        config.getAgents().get(AgentRole.KNOWLEDGE_GOVERNANCE).setModel(null);
        config.getAgents().get(AgentRole.CODING).setSkilldir("skills/main");
        BusinessConfig.EmbeddingModelProperties embedding = config.new EmbeddingModelProperties();
        embedding.setBaseUrl("https://emb.test/v1?api_key=SECRET-EMBEDDING-URL");
        embedding.setApiKey("SECRET-EMBEDDING-KEY");
        embedding.setModelName("emb");
        embedding.setTimeout(Duration.ofSeconds(300));
        embedding.setCustomHeaders(Map.of("X-Key", "SECRET-EMBEDDING-HEADER"));
        config.setEmbeddingModelProperties(embedding);
        DataAdapterConnection connection = new DataAdapterConnection();
        connection.setUrl("jdbc:postgresql://db/x?password=SECRET-URL");
        connection.setPassword("SECRET-DB-PASSWORD");
        config.getDataAdapterConnections().put("postgresql", connection);
        config.setKnowledgeMaxResult(7);
        config.setToolAndPythonRetry(1);
        config.setDslCookerTries(2);
        config.setDslCookerTimeout(300000L);
        config.setQuestionSpliterTries(1);
        config.setQuestionSpliterTimeout(180000L);
        DataRagConfig dataRagConfig = new DataRagConfig();
        dataRagConfig.setProductionEnvPwd("SECRET-PROD");

        String body = response(config, dataRagConfig, new MockEnvironment()
                .withProperty("server.port", "18087")
                .withProperty("server.max-http-post-size", "100MB")
                .withProperty("spring.servlet.multipart.max-file-size", "100MB")
                .withProperty("spring.servlet.multipart.max-request-size", "200MB"));

        assertFalse(body.contains("SECRET"), body);
        assertEquals(sample("diagnostic-config-full.json"), wireConfig(body));
    }

    @Test
    void anEmptyLibraryWithUnsetFieldsGivesTheSparseSample() throws Exception {
        BusinessConfig config = config(List.of(), null);
        String body = response(config, new DataRagConfig(), new MockEnvironment().withProperty("server.port", "18087"));
        assertEquals(sample("diagnostic-config-sparse.json"), wireConfig(body));
    }

    private static BusinessConfig config(List<ModelConfig> models, String roleModel) {
        BusinessConfig config = new BusinessConfig();
        config.setModels(new ArrayList<>(models));
        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        for (String role : AgentRole.ALL) {
            AgentConfig agent = new AgentConfig();
            agent.setModel(roleModel);
            agents.put(role, agent);
        }
        config.setAgents(agents);
        config.setDataAdapter("postgresql");
        return config;
    }

    private static String response(BusinessConfig config, DataRagConfig dataRagConfig, MockEnvironment environment)
            throws Exception {
        BusinessConfigDao dao = mock(BusinessConfigDao.class);
        when(dao.query("d1")).thenReturn(config);
        BusinessConfigServiceImpl service = new BusinessConfigServiceImpl();
        ReflectionTestUtils.setField(service, "businessConfigDao", dao);
        ReflectionTestUtils.setField(service, "dataRagConfig", dataRagConfig);
        ReflectionTestUtils.setField(service, "environment", environment);

        User user = mock(User.class);
        when(user.getDomainId()).thenReturn("d1");
        IdentityService identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        GenericApplicationContext context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identity);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);
        BusinessConfigController controller = new BusinessConfigController();
        ReflectionTestUtils.setField(controller, "businessConfigService", service);

        return MockMvcBuilders.standaloneSetup(controller)
                .setMessageConverters(new MappingJackson2HttpMessageConverter(BOOT_JSON)).build()
                .perform(get("/businessConfig/getConfigAndDesc"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private static JsonNode wireConfig(String body) throws Exception {
        JsonNode response = BOOT_JSON.readTree(body);
        assertTrue(response.get("success").asBoolean(), body);
        assertTrue(response.get("data").get("desc").isTextual(), body);
        ObjectNode config = (ObjectNode) response.get("data").get("config");
        assertTrue(config.get("subQueryCacheDir").asText().endsWith("subQueryCache"), body);
        config.put("subQueryCacheDir", SAMPLE_CACHE_DIR);
        return config;
    }

    private static JsonNode sample(String name) throws Exception {
        return BOOT_JSON.readTree(Files.readString(FIXTURES.resolve(name)));
    }
}
