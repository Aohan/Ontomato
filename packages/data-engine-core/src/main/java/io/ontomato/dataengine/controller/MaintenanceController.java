package io.ontomato.dataengine.controller;


import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.MaintenanceService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.config.ControllerConst;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/maintenance")
public class MaintenanceController {

    @Autowired
    MaintenanceService maintenanceService;

    @Autowired
    LangService langService;

    @GetMapping("/getserviceinfo")
    @ResponseBody
    public JSONObject geServiceInfo()
    {
        JSONObject serviceInfo = maintenanceService.getServicesInfo();
        return serviceInfo;
    }

    @PostMapping("/serviceaction")
    @ResponseBody
    public JSONObject serviceAction(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody String serviceAction)
    {
        JSONObject ret = new JSONObject();
        String service_name = null;
        String service_action = null;
        boolean paramCheck = true;

        Map<String, String> mapServiceAction = JSONObject.parseObject(serviceAction, Map.class);
        if(mapServiceAction.containsKey("service_name")){
            service_name = mapServiceAction.get("service_name");
        } else {
            paramCheck = false;
        }

        if(mapServiceAction.containsKey("action")){
            service_action = mapServiceAction.get("action");
            if(service_action.equals("start") || service_action.equals("stop") || service_action.equals("restart")){
                //OK
            } else {
                paramCheck = false;
            }
        } else {
            paramCheck = false;
        }

        if(!paramCheck){
            ret.put("success", false);
            ret.put("message", langService.get(lang, "Maintenance.action.paramError"));
            return ret;
        }

        JSONObject actionResult = maintenanceService.serviceAction(service_name,service_action);
        return actionResult;
    }
}
