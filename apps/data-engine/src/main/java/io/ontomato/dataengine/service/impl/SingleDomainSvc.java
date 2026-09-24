package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.dao.sys.SysDomain;
import io.ontomato.dataengine.service.DomainSvc;

/**
 * Open-source edition (single domain) domain implementation: fixes a default domain with domainId="1", and does not support multi-domain management.
 */
@Component
public class SingleDomainSvc implements DomainSvc {

    private static final String DEFAULT_DOMAIN_ID = "1";

    private static final SysDomain DEFAULT_DOMAIN = new SysDomain(DEFAULT_DOMAIN_ID, "Default domain", "");

    @Override
    public SysDomain create(String domainName, String domainDesc, String adminLoginCode) {
        throw new UnsupportedOperationException("The open-source edition does not support creating domains");
    }

    @Override
    public List<SysDomain> list() {
        return List.of(DEFAULT_DOMAIN);
    }

    @Override
    public SysDomain update(String domainId, String domainName, String domainDesc) {
        throw new UnsupportedOperationException("The open-source edition does not support modifying domains");
    }

    @Override
    public void delete(String domainId) {
        throw new UnsupportedOperationException("The open-source edition does not support deleting domains");
    }
}
