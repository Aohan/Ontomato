package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * Open-source edition (no users) identity implementation: returns a fixed anonymous user, and all data permissions are allowed through.
 */
@Component
public class AnonymousIdentityService implements IdentityService {

    private static final UserDetail ANONYMOUS_USER = createAnonymousUser();

    private static UserDetail createAnonymousUser() {
        UserDetail user = new UserDetail();
        user.setId("admin");
        user.setLoginCode("admin");
        user.setUserName("admin");
        user.setEnable(true);
        user.setRoles(List.of());
        user.setMenuPermissions(List.of());
        user.setApiPermissions(List.of());
        // Open-source edition single domain: fixed domainId="1", no multi-tenant isolation.
        user.setDomainId("1");
        return user;
    }

    @Override
    public User getCurrentUser() {
        return ANONYMOUS_USER;
    }

    @Override
    public String getCurrentUserId() {
        return ANONYMOUS_USER.getId();
    }

    @Override
    public UserDataPermission getCurrentUserDataPermission() {
        // fullData=true: row permissions and field permissions are not intercepted at all
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        return permission;
    }
}
