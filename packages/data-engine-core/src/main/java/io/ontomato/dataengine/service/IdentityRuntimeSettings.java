package io.ontomato.dataengine.service;

/** SSO and LDAP values placed in the runtime configuration document. */
public interface IdentityRuntimeSettings {
    Object ssoSettings();
    Object ldapSettings();
}
