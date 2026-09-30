package io.ontomato.dataengine.core.bean;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SimpleUser implements User {
    @Schema(description = "User ID")
    private String id;
    @Schema(description = "Account")
    private String loginCode;
    @Schema(description = "Name")
    private String userName;
    @Schema(description = "true: enabled, false: disabled")
    private boolean enable = false;
    @Schema(description = "domainId")
    private String domainId;
}
