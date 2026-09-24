package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.ToolsCalculatorResult;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.JSONCorrector;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ToolsCalculatorService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.util.FileUtil;
import io.ontomato.dataengine.util.UserMessageUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
public class ToolsCalculatorServiceImpl implements ToolsCalculatorService {

	@Autowired
    private JSONCorrector jsonCorrector;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private LangService langService;
	
    @Autowired
    private KnowledgeDao knowledgeDao;

    @Autowired
    private BussinessExampleDao bussinessExampleDao;
    
    @Autowired
	private BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao;

    @Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

    Pattern JSON_PATTERN = Pattern.compile("```json([\\s\\S]+)```" );

    /** Try to use tools for data analysis and judgment
     * @param sessionid
     * @param calculateQuestion
     * @param jsonDataSchema
     * @return
     */
    @Override
    public ToolsCalculatorResult calculate(String sessionid, String calculateQuestion, List<Map> jsonDataSchema, String lang, String domainId) {

        log.info("sessionid:{},calculateQuestion:{}",sessionid,calculateQuestion);

        List<Map> subQuestionResultList = new ArrayList<>();
        boolean commitData = true;
        // Get data files
        for (int i = 0; i < jsonDataSchema.size(); i++) {
            String subQuestion = (String) jsonDataSchema.get(i).get("subQuestion");
            String datajsonfile = (String)jsonDataSchema.get(i).get("datajsonfile");
            String jsondata = FileUtil.getFileLoadAll(datajsonfile, "utf-8");
            JSONArray jsondataArray = JSON.parseArray(jsondata);
            // If the data volume is too large, do not submit the data
//            if(jsondataArray.size() > dataRagConfig.getToolsDataMaxSize()){
//                commitData = false;
//            } else {
//                Map subQuestionResultMap = new HashMap();
//                subQuestionResultMap.put("subQuestion",subQuestion);
//                subQuestionResultMap.put("subQuestionResult",jsondataArray);
//                subQuestionResultList.add(subQuestionResultMap);
//            }
            Map subQuestionResultMap = new HashMap();
            subQuestionResultMap.put("subQuestion",subQuestion);
            subQuestionResultMap.put("subQuestionResult",jsondataArray);
            subQuestionResultList.add(subQuestionResultMap);
        }

        String userMessage = "";
        List<Map> answer = new ArrayList<>();
        String logic = "";
        // If the data volume is not large, the data can be submitted to the LLM, and tools can be tried for judgment
        if(commitData){
        	BusinessConfig businessConfig = businessConfigService.get(domainId);
            userMessage = UserMessageUtil.getToolsCalculatorUserMessage(sessionid, calculateQuestion,
                    subQuestionResultList,jsonDataSchema,knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao, 10,
                    lang, langService, domainId);
            String pySessionid = UUID.randomUUID().toString();
            OriginalQuestion originalQuestion = new OriginalQuestion();
    		originalQuestion.setId(sessionid);
            String calculateChatRetStr = multiThreadAIChatService.chat(MultiThreadAIChatService.TOOL_AND_PYTHON_CALCULATOR,originalQuestion,pySessionid,userMessage,ModelResolver.resolve(businessConfig, AgentRole.TOOL_CHAT), domainId);
            log.info("<<< calculateResult:{}",calculateChatRetStr);
            Matcher matcher = JSON_PATTERN.matcher(calculateChatRetStr);
            if (matcher.find()) {
                String calculateResultStr = matcher.group(1);
                JSONObject calculateResultObject = jsonCorrector.parseObject(calculateResultStr, domainId, sessionid);
                if(calculateResultObject.containsKey("answer")){
                    Object objAnswer = calculateResultObject.get("answer");
                    if(objAnswer instanceof List){
                        answer = (List<Map>) objAnswer;
                    }
                }
                if (calculateResultObject.containsKey("logic")) {
                	logic = calculateResultObject.getString("logic");
                }
            }
        }

        ToolsCalculatorResult result = new ToolsCalculatorResult();
        result.setUserMessage(userMessage);
        result.setAnswer(answer);
        result.setLogic(logic);
        
        return result;
    }
}
