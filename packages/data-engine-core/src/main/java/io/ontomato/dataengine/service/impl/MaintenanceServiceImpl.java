package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.service.MaintenanceService;
import io.ontomato.dataengine.util.MaintenanceUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;


@Slf4j
@Service
public class MaintenanceServiceImpl implements MaintenanceService {

    @Autowired
    private DataRagConfig dataRagConfig;

    private MaintenanceUtil maintenanceUtil = new MaintenanceUtil();
    private JSONObject servicesInfo;

    public JSONObject getServicesInfo(){
        try{
            String m3RootPath = "/opt/matrix";
            if(dataRagConfig.getM3rootpath() != null && dataRagConfig.getM3rootpath().length()>0){
                m3RootPath = dataRagConfig.getM3rootpath().trim();
            }
            JSONObject servicesInfo = maintenanceUtil.collectAll(m3RootPath);
            this.servicesInfo = servicesInfo;
            return  servicesInfo;
        } catch (Exception exp){
            log.error(exp.getMessage(),exp);
            return  new JSONObject();
        }
    }

    public JSONObject serviceAction(String serviceName, String action){
        // Get service list
        if(this.servicesInfo==null){
            this.getServicesInfo();
        }

        // Check whether it is an M3 service
        boolean isM3Service = false;
        JSONObject jsonM3 = this.servicesInfo.getJSONObject("m3");
        JSONArray arrayM3Service = jsonM3.getJSONArray("services");
        int m3ServiceSize = arrayM3Service.size();
        for (int i =0; i <m3ServiceSize;i++){
            JSONObject m3Service =  arrayM3Service.getJSONObject(i);
            String m3ServiceName = m3Service.getString("name");
            if(m3ServiceName.equals(serviceName)){
                isM3Service = true;
                break;
            }
        }

        if(isM3Service){
            String m3RootPath = "/opt/matrix";
            if(dataRagConfig.getM3rootpath() != null && dataRagConfig.getM3rootpath().length()>0){
                m3RootPath = dataRagConfig.getM3rootpath().trim();
            }
            JSONObject actionResult = maintenanceUtil.operateM3Services(m3RootPath,serviceName,action);
            return actionResult;
        }

        // Check whether it is the backend service
        if(serviceName.toLowerCase().equals("dataagent-backend") && action.equals("restart")){
            JSONObject actionResult = maintenanceUtil.restartBackend();
            return actionResult;
        }

        // Check whether it is the frontend container
        String frontPath = "/opt/frontend";
        if(dataRagConfig.getRagchatrootpath() != null && dataRagConfig.getRagchatrootpath().length()>0){
            frontPath = dataRagConfig.getRagchatrootpath().trim();
        }
        if(serviceName.toLowerCase().equals("frontend") && action.equals("restart")){
            JSONObject actionResult = maintenanceUtil.restartFrontend(frontPath);
            return actionResult;
        }

        return new JSONObject();
    }
}
