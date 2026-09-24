package io.ontomato.dataengine.config;

import java.util.Map;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter.Feature;

public final class CustomRequestParameters {

    private CustomRequestParameters() {
    }

    public static Map<String, Object> normalize(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException("customRequestParameters must be a JSON object");
        }
        String serialized = JSON.toJSONString(map, Feature.WriteMapNullValue);
        @SuppressWarnings("unchecked")
        Map<String, Object> copy = JSON.parseObject(
                serialized, Map.class, JSONReader.Feature.DisableReferenceDetect);
        return copy;
    }
}
