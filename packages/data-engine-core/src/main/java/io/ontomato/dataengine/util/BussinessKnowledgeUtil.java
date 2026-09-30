package io.ontomato.dataengine.util;

import io.ontomato.dataengine.dao.*;
import lombok.extern.slf4j.Slf4j;

import java.util.List;

@Slf4j
public class BussinessKnowledgeUtil {
    public static String getBussinessKnowledgeAndExample(KnowledgeDao knowledgeDao,
                                                         BussinessExampleDao bussinessExampleDao, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao,
                                                         String userQuestion, int maxKnowledgeResult, Boolean needQuestionSpliterExample, Boolean needDslCookerExample, 
                                                         String domainId) {

        StringBuffer sb = new StringBuffer();

        // Vectorize and retrieve from the database
        List<KnowledgeEntity> bussinessKnowledges = knowledgeDao.findKnowledge(userQuestion, maxKnowledgeResult, domainId);
        sb.append("## **Business knowledge**\n");
        for (int i = 0; i < bussinessKnowledges.size(); i++) {
            sb.append((i + 1) + ".  " + bussinessKnowledges.get(i).getKnowledgeText() + "\n");
        }
        sb.append("\n");

        // Business query examples
        int questionIndex = 0;
        if (needQuestionSpliterExample) {
        	questionIndex = appendBusinessExampleQuestionSpliter(userQuestion, maxKnowledgeResult, sb, businessExampleQuestionSpliterDao, questionIndex, domainId);
        }
        if (needDslCookerExample) {
        	appendBusinessExampleDslCooker(userQuestion, maxKnowledgeResult, sb, bussinessExampleDao, questionIndex, domainId);
        }
        
        return sb.toString();
    }
    
    private static int appendBusinessExampleQuestionSpliter(String userQuestion, int maxKnowledgeResult, StringBuffer sb, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, int i, String domainId) {
    	List<BusinessExampleQuestionSpliterEntity> listBussinessExampleEntity =  businessExampleQuestionSpliterDao.findBussinessExample(userQuestion, maxKnowledgeResult, domainId);
        if(listBussinessExampleEntity!=null && listBussinessExampleEntity.size()>0) {
            for (BusinessExampleQuestionSpliterEntity bussinessExample : listBussinessExampleEntity) {
            	sb.append("- Example ").append(i+1).append(":\n");
                String exampleQuestion = bussinessExample.getQuestion();
                String content = bussinessExample.getContent();

                sb.append("Question: ").append(exampleQuestion).append("\n");
                if(content != null && content.length()>0){
                	sb.append("Business logic: ").append(content).append("\n");
                }
                i++;
            }
        }
        return i;
    }
    
    private static int appendBusinessExampleDslCooker(String userQuestion, int maxKnowledgeResult, StringBuffer sb, BussinessExampleDao bussinessExampleDao, int i, String domainId) {
    	List<BussinessExampleEntity> listExampleEntity =  bussinessExampleDao.findBussinessExample(userQuestion, maxKnowledgeResult, domainId);
        if(listExampleEntity!=null && listExampleEntity.size()>0){
            for(BussinessExampleEntity example : listExampleEntity){
                sb.append("- Example ").append(i + 1).append(":\n");
                String exampleQuestion = example.getExampleQuestion();
                String stepA = example.getExampleA();
                String stepB = example.getExampleB();
                String stepC = example.getExampleC();
                String important = example.getExampleImportant();

                sb.append("Question: ").append(exampleQuestion).append("\n");
                if(stepA != null && stepA.length()>0){
                    sb.append("Query step A: ").append(stepA).append("\n");
                }
                if(stepB != null && stepB.length()>0){
                    sb.append("Query step B: ").append(stepB).append("\n");
                }
                if(stepC != null && stepC.length()>0){
                    sb.append("Query step C: ").append(stepC).append("\n");
                }
                if(important != null && important.length()>0){
                    sb.append("Notes: ").append(important).append("\n");
                }
                i++;
            }
        }
        return i;
    }
    
}
