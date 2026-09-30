package io.ontomato.dataengine.service;

/**
 * Whether a configured production-environment account is logged in before an outbound call.
 * This is not an inbound user or schema permission check.
 */
public interface ProductionEnvironmentLoginPolicy {

    boolean shouldLogin(String configuredUser);
}
