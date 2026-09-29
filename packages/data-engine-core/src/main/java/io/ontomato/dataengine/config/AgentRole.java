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

    public static String displayName(String role) {
        return switch (role) {
            case QUERY -> "问数";
            case CODING -> "代码与计算";
            case GENERAL -> "通用";
            case DIAGNOSIS -> "运维 Agent";
            case KNOWLEDGE_GOVERNANCE -> "知识治理 Agent";
            default -> role;
        };
    }

    public static String displayNameEn(String role) {
        return switch (role) {
            case QUERY -> "Query";
            case CODING -> "Coding and Computing";
            case GENERAL -> "General";
            case DIAGNOSIS -> "Operations Agent";
            case KNOWLEDGE_GOVERNANCE -> "Knowledge Governance Agent";
            default -> role;
        };
    }

    private AgentRole() {
    }
}
