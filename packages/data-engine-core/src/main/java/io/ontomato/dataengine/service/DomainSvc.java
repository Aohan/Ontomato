package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.dao.sys.SysDomain;

public interface DomainSvc {

    /**
     * Create a domain (atomic: domain + admin user + admin role + position + permission)
     */
    SysDomain create(String domainName, String domainDesc, String adminLoginCode);

    /**
     * superAdmin views all domains
     */
    List<SysDomain> list();

    /**
     * Ids of all domains, for internal system tasks such as startup jobs.
     * Performs no caller-permission check, so it must not be exposed through an API.
     */
    List<String> listDomainIds();

    /**
     * Update a domain's name and description; the domain identifier is immutable
     */
    SysDomain update(String domainId, String domainName, String domainDesc);

    /**
     * Cascade-delete a domain
     */
    void delete(String domainId);
    
}
