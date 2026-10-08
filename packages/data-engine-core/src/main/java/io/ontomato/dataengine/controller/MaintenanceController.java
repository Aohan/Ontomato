package io.ontomato.dataengine.controller;


import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.MaintenanceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/maintenance")
public class MaintenanceController {

    @Autowired
    MaintenanceService maintenanceService;

    @GetMapping("/getserviceinfo")
    @ResponseBody
    public JSONObject geServiceInfo()
    {
        JSONObject serviceInfo = maintenanceService.getServicesInfo();
        return serviceInfo;
    }
}
