package io.ontomato.dataengine.config;

import java.util.Set;

/**
 * Fixed keys for the five roles (the map keys of BusinessConfig.agents).
 */
public final class AgentRole {

    public static final String QUERY = "query";
    public static final String CODING = "coding";
    public static final String GENERAL = "general";
    public static final String DIAGNOSIS = "diagnosis";
    public static final String KNOWLEDGE_GOVERNANCE = "knowledgeGovernance";

    public static final Set<String> ALL = Set.of(
            QUERY,
            CODING,
            GENERAL,
            DIAGNOSIS,
            KNOWLEDGE_GOVERNANCE);

    private AgentRole() {
    }
}
