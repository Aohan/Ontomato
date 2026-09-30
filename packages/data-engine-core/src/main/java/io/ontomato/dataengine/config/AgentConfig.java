package io.ontomato.dataengine.config;

import java.util.Set;

import lombok.Data;

/**
 * The model name referenced by a role + execution data: answers "which model this agent uses, how many replicas, which skill directory".
 * Model request parameters belong to the named model entry (see {@link ModelConfig}); roles only reference them and never override them.
 */
@Data
public class AgentConfig {

    /**
     * Legacy role model field names that have been migrated to ModelConfig: a persisted or API role object still containing any one of them
     * is treated as an unmigrated shape, and an upgrade must be explicitly prompted; it must not be silently dropped.
     */
    public static final Set<String> LEGACY_MODEL_FIELDS = Set.of(
            "temperature", "topP", "stop", "maxTokens", "maxCompletionTokens",
            "presencePenalty", "frequencyPenalty", "logitBias", "responseFormat",
            "strictJsonSchema", "seed", "user", "strictTools", "parallelToolCalls",
            "store", "metadata", "serviceTier", "reasoningEffort",
            "logRequests", "logResponses");

    private String model;
    private String skilldir;
}
