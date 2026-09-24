package io.ontomato.dataengine.service.sys.bean;

import java.util.List;

import io.ontomato.dataengine.core.bean.User;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class UserDetail implements User, UserPermissionable {

    @Schema(description = "User ID")
    private String id;
    @Schema(description = "Account")
    private String loginCode;
    @Schema(description = "Name")
    private String userName;
    @Schema(description = "true: enabled, false: disabled")
    private boolean enable = false;

    @Schema(description = "Role")
    private List<String> roles;

    @Schema(description = "Menu permission")
    private List<String> menuPermissions;

    @Schema(description = "API permission")
    private List<String> apiPermissions;
    
    @Schema(description = "domainId")
    private String domainId;

    @Schema(description = "domainName")
    private String domainName;

    private int isAdmin;


}
