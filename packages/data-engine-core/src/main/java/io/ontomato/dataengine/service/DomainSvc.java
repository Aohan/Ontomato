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
     * Update a domain's name and description; the domain identifier is immutable
     */
    SysDomain update(String domainId, String domainName, String domainDesc);

    /**
     * Cascade-delete a domain
     */
    void delete(String domainId);
    
}
