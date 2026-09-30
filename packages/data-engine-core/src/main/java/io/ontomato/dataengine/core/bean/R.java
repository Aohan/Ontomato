package io.ontomato.dataengine.core.bean;

import io.ontomato.dataengine.core.exception.ServiceException;

import lombok.Data;

@Data
public class R<T> {

    private boolean success;

    private int code = -1;

    private T data;

    private String message;

    public R(Throwable t) {
        this(false, 500, t.getMessage(), null);
//        if (t instanceof ServiceException e && e.hasCode()) {
//            this.code = e.getCode();
//        }
    }

    public R(boolean success, int code, String message) {
        this(success, code, message, null);
    }

    public R(boolean success, int code, String message, T data) {
        this.success = success;
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public R(T data) {
        this(true, 200, null, data);
    }

    public static <T> R<T> of(T data) {
        return new R<>(data);
    }

    public static <T> R<T> ok(T data) {
        return new R<>(data);
    }

}
