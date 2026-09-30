package io.ontomato.dataengine.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.sys.SysDomain;
import io.ontomato.dataengine.service.DomainSvc;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@RequestMapping("/domain")
public class DomainController {

    @Autowired
    private DomainSvc domainSvc;

    @PostMapping("/create")
    @ResponseBody
    public JSONObject create(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            String domainName = param.getString("domainName");
            String domainDesc = param.getString("domainDesc");
            String adminLoginCode = param.getString("adminLoginCode");
            SysDomain domain = domainSvc.create(domainName, domainDesc, adminLoginCode);
            ret.put("success", true);
            ret.put("data", domain);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/list")
    @ResponseBody
    public JSONObject list() {
        JSONObject ret = new JSONObject();
        try {
            ret.put("data", domainSvc.list());
            ret.put("success", true);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/update")
    @ResponseBody
    public JSONObject update(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            String domainId = param.getString("domainId");
            String domainName = param.getString("domainName");
            String domainDesc = param.getString("domainDesc");
            ret.put("data", domainSvc.update(domainId, domainName, domainDesc));
            ret.put("success", true);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/delete")
    @ResponseBody
    public JSONObject delete(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            String domainId = param.getString("domainId");
            domainSvc.delete(domainId);
            ret.put("success", true);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
}
