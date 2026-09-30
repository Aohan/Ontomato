package io.ontomato.dataengine.core.exception;

public class CoreException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public CoreException() {
        super();
    }

    public CoreException(String message) {
        super(message);
    }

    public CoreException(Throwable cause) {
        super(cause);
    }

    public CoreException(String message, Throwable cause) {
        super(message, cause);
    }

}