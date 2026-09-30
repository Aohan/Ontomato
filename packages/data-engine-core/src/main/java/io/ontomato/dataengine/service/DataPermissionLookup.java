package io.ontomato.dataengine.service;

import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface DataPermissionLookup {
    UserDataPermission getDataPermission(String userId, String domainId);
}
