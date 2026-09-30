package io.ontomato.dataengine.dao.sys;

import java.util.Collection;
import java.util.Date;

import io.ontomato.dataengine.core.bean.Condition;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CSysDomain implements Condition {

	private String id;

    private Collection<String> ids;

    private String idEqual;
    
    private String name;

    private Collection<String> names;

    private String nameEqual;
    
    private String description;

    private Collection<String> descriptions;

    private String descriptionEqual;
    
}
