package io.ontomato.dataengine.dao.sys;

import io.ontomato.dataengine.core.bean.Entity;
import io.ontomato.dataengine.core.db.jdbc.TableDesc;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(name = "sys_domain", description = "Domain")
public class SysDomain implements Entity {

	@Schema(description = "ID")
    private String id;
	@Schema(description = "Name")
    private String name;
	@Schema(description = "Description", maxLength = TableDesc.UNLIMITED_TEXT_LENGTH)
    private String description;
	
}
