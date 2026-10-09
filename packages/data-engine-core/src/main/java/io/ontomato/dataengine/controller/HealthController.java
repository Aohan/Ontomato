package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @GetMapping("/health")
    @ResponseBody
    public JSONObject health() {
        JSONObject ret = new JSONObject();
        ret.put("success", true);
        return ret;
    }
}
