package io.ontomato.dataengine.service.sys.bean.permission;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FieldPermissionItem {

    @Schema(description = "Field name, e.g. name  ; time series field bucketName#xxx, e.g. market#cpu_usage ")
    private String name;

    @Schema(description = "Permission level: 0: no permission 1: can view, 2: group only")
    private int level;

}
