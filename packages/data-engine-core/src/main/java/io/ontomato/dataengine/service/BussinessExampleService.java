package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterEntity;
import io.ontomato.dataengine.dao.BussinessExampleEntity;

import java.util.Map;

public interface BussinessExampleService {

    public String findBussinessExample(String question, int pMaxResult, String domainId);
    
    public String findBusinessExampleQuestionSpliter(String question, int pMaxResult, String domainId);
    
    public void addBussinessExample(String exampleJSON, User user);
    
    public void addBusinessExampleQuestionSpliter(String exampleJSON, User user);

    public void editBussinessExample(String exampleJSON, User user);
    
    public void editBusinessExampleQuestionSpliter(String exampleJSON, User user);

    public void delBussinessExample(String exampleID, User user);
    
    public void delBusinessExampleQuestionSpliter(String exampleID, User user);

    public Map<String, BussinessExampleEntity> getBussinessExample(String domainId);
    
    public Map<String, BusinessExampleQuestionSpliterEntity> getBusinessExampleQuestionSpliter(String domainId);

    public String getBussinessExampleMarkdown(String domainId);
    
    public String getBusinessExampleQuestionSpliterMarkdown(String domainId);
}
