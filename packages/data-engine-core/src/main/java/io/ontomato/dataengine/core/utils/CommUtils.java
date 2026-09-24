package io.ontomato.dataengine.core.utils;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.exception.ServiceException;

public class CommUtils {

    public static boolean isEmpty(Object v) {
        if (v == null) {
            return true;
        }
        if (v instanceof String s) {
            return s.isBlank();
        }
        if (v instanceof Collection<?> c) {
            return c.isEmpty();
        }
        if (v instanceof Map<?, ?> m) {
            return m.isEmpty();
        }
        if (v.getClass().isArray()) { // direct check, no helper method needed
            return java.lang.reflect.Array.getLength(v) == 0;
        }
        if (v instanceof Optional<?> opt) {
            return opt.isEmpty();
        }
        return false;
    }

    public static void assertParamNotEmpty(Object data, String msg) {
        assertNotEmpty(data, "Parameter '" + msg + "' must not be empty");
    }

    public static void assertNotEmpty(Object data, String msg) {
        if (isEmpty(data)) {
            throw new ServiceException(msg);
        }
    }

    public static void assertIsEmpty(Object data, String msg) {
        if (!isEmpty(data)) {
            throw new ServiceException(msg);
        }
    }

    public static void assertTrue(boolean ex, String msg) {
        if (!ex) {
            throw new ServiceException(msg);
        }
    }

    public static JSONArray readArray(File f) {
        try {
            return JSON.parseArray(Files.readAllBytes(f.toPath()));
        } catch (IOException e) {
            throw new ServiceException("Failed to read file!", e);
        }
    }

    public static JSONObject readObject(File f) {
        try {
            return JSON.parseObject(Files.readAllBytes(f.toPath()));
        } catch (IOException e) {
            throw new ServiceException("Failed to read file!", e);
        }
    }

}
