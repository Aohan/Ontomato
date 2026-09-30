package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

public class LogHelper {

    public static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LogHelper.class);

    public static void info(String format, JSONObject arg) {
        log.info(format, JSON.toJSONString(arg, Feature.PrettyFormatWith2Space));
    }

    public static void info(String format, Object arg) {
        log.info(format, arg);
    }

    public static void info(String msg) {
        log.info(msg);
    }

    public static void m3ReturnData(String msg) {
        StringBuilder sbb = new StringBuilder("M3 return data>>>:\n" + msg);
        try {
            JSONArray m3 = JSON.parseArray(msg);
            JSONObject obj = (JSONObject) m3.get(0);
            if (obj.containsKey("mqls")) {
                JSONArray jsonArray = obj.getJSONArray("mqls");
                for (Object object : jsonArray) {
                    sbb.append("\n\n").append(object);
                }
            }
        } catch (Exception e) {
        }
        log.info(sbb.toString());
    }

}
