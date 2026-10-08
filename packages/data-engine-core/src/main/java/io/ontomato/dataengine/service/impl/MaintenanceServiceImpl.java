package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.MaintenanceService;
import io.ontomato.dataengine.util.MaintenanceUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;


@Slf4j
@Service
public class MaintenanceServiceImpl implements MaintenanceService {

    private MaintenanceUtil maintenanceUtil = new MaintenanceUtil();

    public JSONObject getServicesInfo(){
        try{
            return maintenanceUtil.collectAll();
        } catch (Exception exp){
            log.error(exp.getMessage(),exp);
            return  new JSONObject();
        }
    }
}
