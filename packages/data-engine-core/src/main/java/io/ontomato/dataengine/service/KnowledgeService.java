package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;

import java.util.List;
import java.util.Map;

public interface KnowledgeService {
	
    public String findKnowledge(String question, int pMaxResult, String domainId);

    public void addBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user);

    public void editBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user);

    public void delBussinessKnowledge(String knowledgeID, User user);

    public Map<String,KnowledgeEntity> getBussinessKnowledge(String domainId);

    public String getBussinessKnowledgeMarkdown(String domainId);

    public List<Map<String,String>> generateBussinessKnowledgeAI(List<Map<String,String>> userTalkJson, Map<String, Object> jsonRule, String lang, String domainId);

}
