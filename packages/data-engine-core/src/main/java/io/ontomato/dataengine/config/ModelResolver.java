package io.ontomato.dataengine.config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The only read/write entry point of the model registry.
 * At runtime, parameters are fetched only through {@link #resolve}, and save validation only through {@link #validateForSave},
 * when a reference does not exist an error is thrown directly, with no fallback to some default model.
 */
public final class ModelResolver {

    private ModelResolver() {
    }

    /** Construction parameters after merging "model + role parameters", produced by resolve. */
    public record ResolvedChatModel(String role, ModelConfig model, AgentConfig agent) {

        public String getBaseUrl() {
            return model.getBaseUrl();
        }

        public List<String> getApiKeys() {
            return model.getApiKeys();
        }

        public String getOrganizationId() {
            return model.getOrganizationId();
        }

        public String getProjectId() {
            return model.getProjectId();
        }

        public String getModelName() {
            return model.getModelName();
        }

        public Double getTemperature() {
            return model.getTemperature();
        }

        public Double getTopP() {
            return model.getTopP();
        }

        public Duration getTimeout() {
            return model.getTimeout();
        }

        public Boolean getLogRequests() {
            return model.getLogRequests();
        }

        public Boolean getLogResponses() {
            return model.getLogResponses();
        }

        public Map<String, String> getCustomHeaders() {
            return model.getCustomHeaders();
        }

        public Map<String, Object> getCustomRequestParameters() {
            return model.getCustomRequestParameters();
        }

        public String getSkilldir() {
            return agent.getSkilldir();
        }
    }

    public static ResolvedChatModel resolve(BusinessConfig config, String role) {
        if (!AgentRole.ALL.contains(role)) {
            throw new IllegalArgumentException("Unknown model role: " + role);
        }
        Map<String, AgentConfig> agents = config.getAgents();
        AgentConfig agent = agents == null ? null : agents.get(role);
        if (agent == null || agent.getModel() == null || agent.getModel().isBlank()) {
            throw new IllegalStateException("Role has no model reference configured: " + role);
        }
        ModelConfig model = findModel(config, agent.getModel());
        if (model == null) {
            throw new IllegalStateException(
                    "Model referenced by role " + role + " does not exist: " + agent.getModel());
        }
        return new ResolvedChatModel(role, model, agent);
    }

    /** The only validation at the save boundary: the name is unique and non-empty, all five roles are present with existing references (deleting a referenced model is rejected). */
    public static void validateForSave(BusinessConfig config) {
        List<ModelConfig> models = config.getModels() == null ? List.of() : config.getModels();
        Set<String> names = new HashSet<>();
        for (ModelConfig model : models) {
            if (model.getName() == null || model.getName().isBlank()) {
                throw new IllegalArgumentException("Model name must not be empty");
            }
            if (!names.add(model.getName())) {
                throw new IllegalArgumentException("Duplicate model name: " + model.getName());
            }
        }
        Map<String, AgentConfig> agents = config.getAgents() == null ? Map.of() : config.getAgents();
        for (String role : AgentRole.ALL) {
            AgentConfig agent = agents.get(role);
            if (agent == null) {
                throw new IllegalArgumentException("Missing role configuration: " + role);
            }
            if (agent.getModel() == null || agent.getModel().isBlank()) {
                throw new IllegalArgumentException("Role does not reference a model: " + role);
            }
            if (!names.contains(agent.getModel())) {
                throw new IllegalArgumentException(
                        "Model referenced by role " + role + " does not exist: " + agent.getModel());
            }
        }
    }

    /**
     * Saving the model list requires every entry to carry its connection: base URL, at least one non-blank API key and the API model name.
     * Only saveModels calls this; role saves and template seeding go through validateForSave alone, so a model still blank after migration does not block them.
     */
    public static void requireConnections(List<ModelConfig> models) {
        for (ModelConfig model : models) {
            if (isBlank(model.getBaseUrl())) {
                throw new IllegalArgumentException("Model " + model.getName() + ": baseUrl must not be empty");
            }
            if (model.getApiKeys() == null || model.getApiKeys().stream().allMatch(ModelResolver::isBlank)) {
                throw new IllegalArgumentException("Model " + model.getName() + ": at least one API key is required");
            }
            if (isBlank(model.getModelName())) {
                throw new IllegalArgumentException("Model " + model.getName() + ": modelName must not be empty");
            }
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /**
     * Compatibility for legacy records at the read boundary: when the display name is missing it is initialized to the config ID (name), and a missing/null apiKeys is returned as an empty array meaning not configured.
     * Neither the display name nor the keys take part in references; real strings (including empty strings) are kept as-is; nothing is written back to the database and no migration is added.
     * A null models uses the same tolerance as validateForSave, so this normalization does not make legacy records fail to read.
     */
    public static void normalizeForRead(List<ModelConfig> models) {
        if (models == null) {
            return;
        }
        for (ModelConfig model : models) {
            if (model.getDisplayName() == null || model.getDisplayName().isBlank()) {
                model.setDisplayName(model.getName());
            }
            if (model.getApiKeys() == null) {
                model.setApiKeys(new ArrayList<>());
            }
        }
    }

    /**
     * A role object that still contains legacy model fields is treated as an unmigrated shape: called at the read and save boundaries, it reports an explicit error instead of silently dropping fields.
     */
    public static void rejectLegacyRoleFields(Map<String, ?> agents) {
        if (agents == null) {
            return;
        }
        for (Map.Entry<String, ?> entry : agents.entrySet()) {
            if (!(entry.getValue() instanceof Map<?, ?> role)) {
                continue;
            }
            for (String legacy : AgentConfig.LEGACY_MODEL_FIELDS) {
                if (role.containsKey(legacy)) {
                    throw new IllegalArgumentException(
                            "Role " + entry.getKey() + " still contains model parameter " + legacy + "; run the upgrade migration first");
                }
            }
        }
    }

    private static ModelConfig findModel(BusinessConfig config, String name) {
        if (config.getModels() == null || name == null) {
            return null;
        }
        for (ModelConfig model : config.getModels()) {
            if (name.equals(model.getName())) {
                return model;
            }
        }
        return null;
    }
}
