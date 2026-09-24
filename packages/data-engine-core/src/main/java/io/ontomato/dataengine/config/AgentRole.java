package io.ontomato.dataengine.config;

import java.util.Set;

/**
 * Fixed keys for the five roles (the map keys of BusinessConfig.agents and the modelsByRole keys of saveAgentModels).
 * The number of roles is unchanged in this round; models are not switched per request.
 */
public final class AgentRole {

    public static final String NORMAL_CHAT = "normalChat";
    public static final String QUESTION_SPLITER = "questionSpliter";
    public static final String CLEVER_NORMAL_CHAT = "cleverNormalChat";
    public static final String PYTHON_CHAT = "pythonChat";
    public static final String TOOL_CHAT = "toolChat";

    public static final Set<String> ALL = Set.of(
            NORMAL_CHAT,
            QUESTION_SPLITER,
            CLEVER_NORMAL_CHAT,
            PYTHON_CHAT,
            TOOL_CHAT);

    private AgentRole() {
    }
}
