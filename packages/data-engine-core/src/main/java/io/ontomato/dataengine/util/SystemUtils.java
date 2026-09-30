package io.ontomato.dataengine.util;


import org.springframework.beans.BeanUtils;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.utils.CommUtils;
import io.ontomato.dataengine.core.utils.Constants;


public class SystemUtils extends CommUtils {

    /**
     * The default root ID of the tree structure
     */
    public static final String ROOT_PARENT_ID = "0";


    public static final String USER_KEY = Constants.USER_KEY;
    public static final String SUPER_ADMIN = "superAdmin";



    public static User getCurUser() {
        return SpringBeanUtil.getBean(io.ontomato.dataengine.service.IdentityService.class).getCurrentUser();
    }

    public static String getCurUserId() {
        return SpringBeanUtil.getBean(io.ontomato.dataengine.service.IdentityService.class).getCurrentUserId();
    }



    public static <T> T copy(Object source, Class<? extends T> clazz) {
        T t = BeanUtils.instantiateClass(clazz);
        BeanUtils.copyProperties(source, t);
        return t;
    }

}
