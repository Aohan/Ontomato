package io.ontomato.dataengine.logging;

import java.util.UUID;

public class AgentCallContext {

    private static final ThreadLocal<AgentCallContext> CONTEXT = new ThreadLocal<>();

    private final String agentRunId;
    private final String sessionId;
    private final String agentName;
    private final String domainId;
    private int round;

    private AgentCallContext(String sessionId, String agentName, String domainId) {
        this.agentRunId = UUID.randomUUID().toString();
        this.sessionId = sessionId;
        this.agentName = agentName;
        this.domainId = domainId;
    }

    public static void begin(String sessionId, String agentName, String domainId) {
        CONTEXT.set(new AgentCallContext(sessionId, agentName, domainId));
    }

    public static void end() {
        CONTEXT.remove();
    }

    public static AgentCallContext current() {
        return CONTEXT.get();
    }

    public int nextRound() {
        return ++round;
    }

    public String getAgentRunId() {
        return agentRunId;
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getAgentName() {
        return agentName;
    }
    
    public String getDomainId() {
        return domainId;
    }
}
