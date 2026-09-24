package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterEntity;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.BussinessExampleEntity;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.BussinessExampleService;
import io.ontomato.dataengine.service.LangService;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class BussinessExampleServiceImpl implements BussinessExampleService {

    @Autowired
	private BusinessConfigService businessConfigService;
    
    @Autowired
	private LangService langService;
    
    @Autowired
    private BussinessExampleDao bussinessExampleDao;
    
    @Autowired
    private BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao;
    
    @Autowired
    private AuditLogDao auditLogDao;

    @Override
    public String findBussinessExample(String question, int pMaxResult, String domainId) {

        int maxResult = businessConfigService.get(domainId).getKnowledgeMaxResult() ;
        if(pMaxResult > 0){
            maxResult = pMaxResult;
        }
        StringBuffer sbExample = new StringBuffer();
        List<BussinessExampleEntity> listExample = bussinessExampleDao.findBussinessExample(question,maxResult,domainId);
        if(listExample!=null && listExample.size()>0){
            sbExample.append("### **Business Query Examples**\n");
            for (int i = 0; i < listExample.size(); i++) {
                BussinessExampleEntity example = listExample.get(i);
                sbExample.append("- Example ").append(i + 1).append(":\n");
                String exampleQuestion = example.getExampleQuestion();
                String stepA = example.getExampleA();
                String stepB = example.getExampleB();
                String stepC = example.getExampleC();
                String important = example.getExampleImportant();

                sbExample.append("Question: ").append(exampleQuestion).append("\n");
                if(stepA != null && stepA.length()>0){
                    sbExample.append("Query step A: ").append(stepA).append("\n");
                }
                if(stepB != null && stepB.length()>0){
                    sbExample.append("Query step B: ").append(stepB).append("\n");
                }
                if(stepC != null && stepC.length()>0){
                    sbExample.append("Query step C: ").append(stepC).append("\n");
                }
                if(important != null && important.length()>0){
                    sbExample.append("Notes: ").append(important).append("\n");
                }
            }
            sbExample.append("\n");
        }

        return sbExample.toString();
    }
    
    @Override
    public String findBusinessExampleQuestionSpliter(String question, int pMaxResult, String domainId) {

        int maxResult = businessConfigService.get(domainId).getKnowledgeMaxResult() ;
        if(pMaxResult > 0){
            maxResult = pMaxResult;
        }
        StringBuffer sbExample = new StringBuffer();
        List<BusinessExampleQuestionSpliterEntity> listExample = businessExampleQuestionSpliterDao.findBussinessExample(question,maxResult,domainId);
        if(listExample!=null && listExample.size()>0){
            sbExample.append("### **Business Query Examples**\n");
            for (int i = 0; i < listExample.size(); i++) {
            	BusinessExampleQuestionSpliterEntity example = listExample.get(i);
                sbExample.append("- Example ").append(i + 1).append(":\n");
                String content = example.getContent();

                sbExample.append("Question: ").append(example.getQuestion()).append("\n");
                if(content != null && content.length()>0){
                    sbExample.append("Business logic: ").append(content).append("\n");
                }
            }
            sbExample.append("\n");
        }

        return sbExample.toString();
    }

    @Override
    public void addBussinessExample(String exampleJSON, User user) {
        BussinessExampleEntity bussinessExampleEntity = JSONObject.parseObject(exampleJSON,BussinessExampleEntity.class);
        String exampleID = UUID.randomUUID().toString();
        bussinessExampleEntity.setExampleID(exampleID);
        bussinessExampleEntity.setModifyTime(new Date());
        bussinessExampleDao.insertBussinessExample(bussinessExampleEntity, user.getDomainId());
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_ADD);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.add") + ": " + bussinessExampleEntity.getExampleQuestion());
        auditLog.setParamter(JSONObject.toJSONString(bussinessExampleEntity));
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }
    
    @Override
    public void addBusinessExampleQuestionSpliter(String exampleJSON, User user) {
        BusinessExampleQuestionSpliterEntity bussinessExampleEntity = JSONObject.parseObject(exampleJSON,BusinessExampleQuestionSpliterEntity.class);
        String exampleID = UUID.randomUUID().toString();
        bussinessExampleEntity.setId(exampleID);
        bussinessExampleEntity.setCreateTimestamp(System.currentTimeMillis());
        bussinessExampleEntity.setModifyTimestamp(System.currentTimeMillis());
        businessExampleQuestionSpliterDao.insertBussinessExample(bussinessExampleEntity, user.getDomainId());
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_ADD);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.add") + ": " + bussinessExampleEntity.getQuestion());
        auditLog.setParamter(JSONObject.toJSONString(bussinessExampleEntity));
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }

    @Override
    public void editBussinessExample(String exampleJSON, User user) {
        BussinessExampleEntity bussinessExampleEntity = JSONObject.parseObject(exampleJSON,BussinessExampleEntity.class);
//        String exampleID = bussinessExampleEntity.getExampleID();
        bussinessExampleEntity.setModifyTime(new Date());
        bussinessExampleDao.insertBussinessExample(bussinessExampleEntity, user.getDomainId());
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_UPD);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.upd") + ": " + bussinessExampleEntity.getExampleQuestion());
        auditLog.setParamter(JSONObject.toJSONString(bussinessExampleEntity));
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }
    
    @Override
    public void editBusinessExampleQuestionSpliter(String exampleJSON, User user) {
        BusinessExampleQuestionSpliterEntity bussinessExampleEntity = JSONObject.parseObject(exampleJSON,BusinessExampleQuestionSpliterEntity.class);
        bussinessExampleEntity.setModifyTimestamp(System.currentTimeMillis());
        businessExampleQuestionSpliterDao.insertBussinessExample(bussinessExampleEntity, user.getDomainId());
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_UPD);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.upd") + ": " + bussinessExampleEntity.getQuestion());
        auditLog.setParamter(JSONObject.toJSONString(bussinessExampleEntity));
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }

    @Override
    public void delBussinessExample(String exampleID, User user) {
        bussinessExampleDao.deleteKnowledge(exampleID);
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_DEL);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.del") + ": " + exampleID);
        auditLog.setParamter(exampleID);
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }
    
    @Override
    public void delBusinessExampleQuestionSpliter(String exampleID, User user) {
    	businessExampleQuestionSpliterDao.deleteKnowledge(exampleID);
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BEXAMPLE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_DEL);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessExample.del") + ": " + exampleID);
        auditLog.setParamter(exampleID);
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }

    @Override
    public Map<String, BussinessExampleEntity> getBussinessExample(String domainId) {
        List<BussinessExampleEntity> listBussinessExampleEntity =  bussinessExampleDao.getAllBussinessExample(domainId);
        Map<String, BussinessExampleEntity> bussinessExamples = new java.util.HashMap<>();
        for (BussinessExampleEntity bussinessExampleEntity : listBussinessExampleEntity) {
            bussinessExamples.put(bussinessExampleEntity.getExampleID(), bussinessExampleEntity);
        }
        return bussinessExamples;
    }
    
    @Override
    public Map<String, BusinessExampleQuestionSpliterEntity> getBusinessExampleQuestionSpliter(String domainId) {
        List<BusinessExampleQuestionSpliterEntity> listBussinessExampleEntity =  businessExampleQuestionSpliterDao.getAllBussinessExample(domainId);
        Map<String, BusinessExampleQuestionSpliterEntity> bussinessExamples = new java.util.HashMap<>();
        for (BusinessExampleQuestionSpliterEntity bussinessExampleEntity : listBussinessExampleEntity) {
            bussinessExamples.put(bussinessExampleEntity.getId(), bussinessExampleEntity);
        }
        return bussinessExamples;
    }

    @Override
    public String getBussinessExampleMarkdown(String domainId){
        List<BussinessExampleEntity> listBussinessExampleEntity =  bussinessExampleDao.getAllBussinessExample(domainId);
        StringBuffer sbBussinessExample = new StringBuffer();
        if(listBussinessExampleEntity!=null && listBussinessExampleEntity.size()>0) {
            sbBussinessExample.append("## **DSL Generator Business Query Examples**\n");

            for (int i=0;i<listBussinessExampleEntity.size();i++) {
                BussinessExampleEntity bussinessExample = listBussinessExampleEntity.get(i);
                sbBussinessExample.append("- Example ").append(i+1).append(":\n");
                String exampleQuestion = bussinessExample.getExampleQuestion();
                String stepA = bussinessExample.getExampleA();
                String stepB = bussinessExample.getExampleB();
                String stepC = bussinessExample.getExampleC();
                String important = bussinessExample.getExampleImportant();

                sbBussinessExample.append("Question: ").append(exampleQuestion).append("\n");
                if(stepA != null && stepA.length()>0){
                    sbBussinessExample.append("Query step A: ").append(stepA).append("\n");
                }
                if(stepB != null && stepB.length()>0){
                    sbBussinessExample.append("Query step B: ").append(stepB).append("\n");
                }
                if(stepC != null && stepC.length()>0){
                    sbBussinessExample.append("Query step C: ").append(stepC).append("\n");
                }
                if(important != null && important.length()>0){
                    sbBussinessExample.append("Notes: ").append(important).append("\n");
                }
            }
        }

        return sbBussinessExample.toString();
    }
    
    @Override
    public String getBusinessExampleQuestionSpliterMarkdown(String domainId){
        List<BusinessExampleQuestionSpliterEntity> listBussinessExampleEntity =  businessExampleQuestionSpliterDao.getAllBussinessExample(domainId);
        StringBuffer sbBussinessExample = new StringBuffer();
        if(listBussinessExampleEntity!=null && listBussinessExampleEntity.size()>0) {
            sbBussinessExample.append("## **Question Analyst Business Query Examples**\n");

            for (int i=0;i<listBussinessExampleEntity.size();i++) {
            	BusinessExampleQuestionSpliterEntity bussinessExample = listBussinessExampleEntity.get(i);
                sbBussinessExample.append("- Example ").append(i+1).append(":\n");
                String exampleQuestion = bussinessExample.getQuestion();
                String content = bussinessExample.getContent();

                sbBussinessExample.append("Question: ").append(exampleQuestion).append("\n");
                if(content != null && content.length()>0){
                    sbBussinessExample.append("Business logic: ").append(content).append("\n");
                }
            }
        }

        return sbBussinessExample.toString();
    }
}
