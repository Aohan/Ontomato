package io.ontomato.dataengine.service.impl;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/** OSS has no permission rows, so every lookup is full data. */
@Component
public class AnonymousDataPermissionLookup implements DataPermissionLookup {

    @Override
    public UserDataPermission getDataPermission(String userId, String domainId) {
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        return permission;
    }
}
