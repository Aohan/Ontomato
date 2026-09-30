package io.ontomato.dataengine.core.bean;

import lombok.Data;

@Data
public class PageCdt<T> {

    private Integer pageNum;
    private Integer pageSize;
    private T cdt;

}
