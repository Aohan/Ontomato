package io.ontomato.dataengine.core.bean;

import java.util.List;
import java.util.function.Function;

import lombok.Data;

@Data
public class Page<D> {

    protected int pageNum;

    protected int pageSize;

    protected long totalRows;

    protected long totalPages;

    protected List<D> data;

    public Page() {
    }

    public Page(int pageNum, int pageSize, long totalRows, long totalPages, List<D> data) {
        this.pageNum = pageNum;
        this.pageSize = pageSize;
        this.totalRows = totalRows;
        this.totalPages = totalPages;
        this.data = data;
    }

    public Page(Page<?> page, Function<List<?>, List<D>> conver) {
        this.pageNum = page.getPageNum();
        this.pageSize = page.getPageSize();
        this.totalRows = page.getTotalRows();
        this.totalPages = page.getTotalPages();
        this.data = conver.apply(page.getData());
    }

    public Page(int pageNum, int pageSize, long totalRows, List<D> data) {
        this.pageNum = pageNum;
        this.pageSize = pageSize;
        this.totalRows = totalRows;
        this.totalPages = totalRows / pageSize;
        if (totalRows % pageSize != 0) {
            this.totalPages++;
        }
        this.data = data;
    }

    public static <T, D> Page<D> from(Page<T> page, Function<List<T>, List<D>> conver) {
        Page<D> r = new Page<>();
        r.pageNum = page.getPageNum();
        r.pageSize = page.getPageSize();
        r.totalRows = page.getTotalRows();
        r.totalPages = page.getTotalPages();
        r.data = conver.apply(page.getData());
        return r;
    }

}