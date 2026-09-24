package io.ontomato.dataengine.service.impl;

import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.IdentityRuntimeSettings;

/**
 * OSS runtime document keeps the sso and ldap keys and carries no enterprise fields.
 * datarag 1cc5d2ea placed SSOProps and LdapProps instances in those keys.
 */
@Component
public class OssIdentityRuntimeSettings implements IdentityRuntimeSettings {

    @Override
    public Object ssoSettings() {
        return Map.of();
    }

    @Override
    public Object ldapSettings() {
        return Map.of();
    }
}
