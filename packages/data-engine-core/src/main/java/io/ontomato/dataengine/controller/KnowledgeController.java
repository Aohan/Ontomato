package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.util.SystemUtils;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/knowledge")
public class KnowledgeController {

    @Autowired
    private KnowledgeService knowledgeService;
    
    @Autowired
    private AdminService adminService;

    @PostMapping("/findknowledge")
    @ResponseBody
    public String findKnowledge(@RequestBody String findJson)
    {
    	User user = SystemUtils.getCurUser();
        JSONObject jsonObject = JSONObject.parseObject(findJson);
        String question = jsonObject.getString("question");
        int pMaxResult = 0;
        if(jsonObject.containsKey("max_result")){
            pMaxResult = jsonObject.getInteger("max_result");
        }

        String knowledgeMarkdown =knowledgeService.findKnowledge(question, pMaxResult, user.getDomainId());
    	return knowledgeMarkdown;
    }

    @PostMapping("/createknowledgeai")
    @ResponseBody
    public JSONObject createKnowledgeByAI(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody String userTalkJson)
    {
    	User user = SystemUtils.getCurUser();
        JSONObject ret = new JSONObject();

        List<Map<String, String>> userTalk = JSONObject.parseObject(userTalkJson, List.class);
        List<Map<String,String>> newJsonKnowledge = knowledgeService.generateBussinessKnowledgeAI(userTalk, adminService.getJSONRule(user.getDomainId()), lang, user.getDomainId());
        ret.put("success", true);
        ret.put("data", newJsonKnowledge);
        return ret;
    }
}
