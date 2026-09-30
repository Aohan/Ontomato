package io.ontomato.dataengine.core.bean;

public interface User {

    String getId();

    String getLoginCode();

    String getUserName();

    boolean isEnable();
    
    String getDomainId();

}
