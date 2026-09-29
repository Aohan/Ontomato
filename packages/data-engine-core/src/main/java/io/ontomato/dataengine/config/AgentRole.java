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

    public static String displayName(String role, String lang) {
        boolean isEn = "en".equalsIgnoreCase(lang);
        return switch (role) {
            case QUERY -> isEn ? "Query" : "问数";
            case CODING -> isEn ? "Coding and Computing" : "代码与计算";
            case GENERAL -> isEn ? "General" : "通用";
            case DIAGNOSIS -> isEn ? "Operations Agent" : "运维 Agent";
            case KNOWLEDGE_GOVERNANCE -> isEn ? "Knowledge Governance Agent" : "知识治理 Agent";
            default -> role;
        };
    }

    private AgentRole() {
    }
}
