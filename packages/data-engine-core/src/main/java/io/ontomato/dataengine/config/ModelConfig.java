package io.ontomato.dataengine.config;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import lombok.Data;

/**
 * One model in the registry: answers "where to connect, which key to use, which request parameters to use".
 * Ownership rule: the model connection and model request parameters are uniformly owned by the named model entry, and roles only reference them;
 * multiple named configurations may exist for the same API model id.
 */
@Data
public class ModelConfig {

    /** Configuration ID unique within the domain: entered on creation, immutable after creation; roles only reference it via agents.*.model. */
    private String name;
    /** Display name, modifiable; when absent it is initialized to name at the read/seed boundary and does not participate in any reference. */
    private String displayName;
    private String baseUrl;
    private List<String> apiKeys;
    private String organizationId;
    private String projectId;
    private String modelName;
    private Duration timeout;
    private Integer maxRetries;
    private Double temperature;
    private Double topP;
    private List<String> stop;
    private Integer maxTokens;
    private Integer maxCompletionTokens;
    private Integer contextWindow;
    private Double presencePenalty;
    private Double frequencyPenalty;
    private Map<String, Integer> logitBias;
    private String responseFormat;
    private Boolean strictJsonSchema;
    private Integer seed;
    private String user;
    private Boolean parallelToolCalls;
    private Boolean store;
    private Map<String, String> metadata;
    private String serviceTier;
    private String reasoningEffort;
    private Boolean logRequests;
    private Boolean logResponses;
    private Map<String, Object> customRequestParameters = new LinkedHashMap<>();
    private Map<String, String> customHeaders;
    private Set<dev.langchain4j.model.chat.Capability> supportedCapabilities;
}
