package io.ontomato.dataengine.service.sys.bean;

import java.util.List;

public interface UserPermissionable {
    List<String> getRoles();

    List<String> getMenuPermissions();

    List<String> getApiPermissions();
}
