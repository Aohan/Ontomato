package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterEntity;
import io.ontomato.dataengine.dao.BussinessExampleEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import io.ontomato.dataengine.service.BussinessExampleService;
import io.ontomato.dataengine.util.SystemUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/bussinessexample")
public class BussinessExampleController {

    @Autowired
    private BussinessExampleService bussinessExampleService;

    @PostMapping("/find")
    public String findExample(@RequestBody String findJson){
    	User user = SystemUtils.getCurUser();
        JSONObject jsonObject = JSONObject.parseObject(findJson);
        String question = jsonObject.getString("question");
        int pMaxResult = 0;
        if(jsonObject.containsKey("max_result")){
            pMaxResult = jsonObject.getInteger("max_result");
        }
        String exampleMarkDown = bussinessExampleService.findBussinessExample(question, pMaxResult, user.getDomainId());
        return  exampleMarkDown;
    }
    
    @PostMapping("/find_question_spliter")
    public String findExampleQuestionSpliter(@RequestBody String findJson){
    	User user = SystemUtils.getCurUser();
        JSONObject jsonObject = JSONObject.parseObject(findJson);
        String question = jsonObject.getString("question");
        int pMaxResult = 0;
        if(jsonObject.containsKey("max_result")){
            pMaxResult = jsonObject.getInteger("max_result");
        }
        String exampleMarkDown = bussinessExampleService.findBusinessExampleQuestionSpliter(question, pMaxResult, user.getDomainId());
        return  exampleMarkDown;
    }

    @PostMapping("/getall")
    @ResponseBody
    public JSONObject getBussinessKnowledgeExample() {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            Map<String, BussinessExampleEntity> bussinessKnowledgeExamples = bussinessExampleService.getBussinessExample(user.getDomainId());

            List<BussinessExampleEntity> listExample = new ArrayList<>();
            bussinessKnowledgeExamples.keySet().stream().forEach(key -> {
                BussinessExampleEntity example = bussinessKnowledgeExamples.get(key);
                listExample.add(example);
            });

            ret.put("success", true);
            ret.put("data", listExample);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
    
    @PostMapping("/getall_question_spliter")
    @ResponseBody
    public JSONObject getBusinessKnowledgeExampleQuestionSpliter() {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            Map<String, BusinessExampleQuestionSpliterEntity> bussinessKnowledgeExamples = bussinessExampleService.getBusinessExampleQuestionSpliter(user.getDomainId());

            List<BusinessExampleQuestionSpliterEntity> listExample = new ArrayList<>();
            bussinessKnowledgeExamples.keySet().stream().forEach(key -> {
            	BusinessExampleQuestionSpliterEntity example = bussinessKnowledgeExamples.get(key);
                listExample.add(example);
            });

            ret.put("success", true);
            ret.put("data", listExample);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/add")
    @ResponseBody
    public JSONObject addBussinessKnowledgeExample(@RequestBody String exampleJSON) {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            bussinessExampleService.addBussinessExample(exampleJSON, user);
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
    
    @PostMapping("/add_question_spliter")
    @ResponseBody
    public JSONObject addBusinessKnowledgeExampleQuestionSpliter(@RequestBody String exampleJSON) {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            bussinessExampleService.addBusinessExampleQuestionSpliter(exampleJSON, user);
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/del")
    @ResponseBody
    public JSONObject delBussinessKnowledgeExample(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            String exampleID = param.getString("exampleID");
            if (exampleID != null) {
            	User user = SystemUtils.getCurUser();
                bussinessExampleService.delBussinessExample(exampleID, user);
            }
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
    
    @PostMapping("/del_question_spliter")
    @ResponseBody
    public JSONObject delBusinessKnowledgeExampleQuestionSpliter(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            String exampleID = param.getString("id");
            if (exampleID != null) {
            	User user = SystemUtils.getCurUser();
                bussinessExampleService.delBusinessExampleQuestionSpliter(exampleID, user);
            }
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/edit")
    @ResponseBody
    public JSONObject editBussinessKnowledgeExample(@RequestBody String exampleJSON) {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            bussinessExampleService.editBussinessExample(exampleJSON, user);
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
    
    @PostMapping("/edit_question_spliter")
    @ResponseBody
    public JSONObject editBusinessKnowledgeExampleQuestionSpliter(@RequestBody String exampleJSON) {
        JSONObject ret = new JSONObject();
        try {
        	User user = SystemUtils.getCurUser();
            bussinessExampleService.editBusinessExampleQuestionSpliter(exampleJSON, user);
            ret.put("success", true);
        } catch (Exception e) {
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }
}
