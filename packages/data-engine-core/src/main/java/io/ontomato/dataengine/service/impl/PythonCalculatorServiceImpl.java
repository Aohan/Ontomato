package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.PythonCalculatorResult;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity.Source;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.PythonCalculatorService;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.tools.AfterCalculatorSubmitTools;
import io.ontomato.dataengine.util.UserMessageUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
public class PythonCalculatorServiceImpl implements PythonCalculatorService {
	
	@Autowired
	private PythonExecuteService pythonExecuteService;

	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
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

    File pythonPath = new File("./python");

    Pattern ANSWER_JSON_PATTERN = Pattern.compile("(\\{[\\s\\S]+\\})" );

    @Override
    public PythonCalculatorResult calculate(String sessionid, String calculateQuestion, List<Map> jsonDataSchema, String originSessionId, String lang, String domainId) {

        log.info("sessionid:{},calculateQuestion:{}",sessionid,calculateQuestion);
        PythonCalculatorResult result = new PythonCalculatorResult();

        String jsonDataSchemaStr =JSON.toJSONString(jsonDataSchema, JSONWriter.Feature.PrettyFormat, JSONWriter.Feature.WriteMapNullValue);
        log.info("jsonDataSchema:\n{}",jsonDataSchemaStr);

        BusinessConfig businessConfig = businessConfigService.get(domainId);
        String userMessage = UserMessageUtil.getPythonCalculatorUserMessage(sessionid, calculateQuestion,jsonDataSchema,
                knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao, 10,
                lang, langService, domainId);
        result.setUserMessage(userMessage);
        // Memory key = session sessionid prefix (for agent-llm logs to search by session) + random tail segment (isolated from tool post-calculation and memories of previous calls)
        String pySessionid = BackendSessionEntrance.derive(sessionid, "pycalc-" + UUID.randomUUID().toString().substring(0, 8));
        OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(originSessionId);
		try {
			agentWorkspaceService.createWorkspace(pySessionid);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		try {
        multiThreadAIChatService.chat(MultiThreadAIChatService.PYTHON_CALCULATOR,originalQuestion,pySessionid,userMessage,ModelResolver.resolve(businessConfig, AgentRole.CODING, langService), domainId);

        // Deliveries come only from submission registration
        String submitted = agentWorkspaceService.getSubmission(pySessionid);
        if (submitted != null) {
        	JSONObject envelope = null;
        	try {
        		envelope = JSONObject.parseObject(submitted);
        	} catch (Exception e) {
        		log.error(e.getMessage(), e);
        	}
        	if (envelope != null && AfterCalculatorSubmitTools.KIND_PROGRAM.equals(envelope.getString(AfterCalculatorSubmitTools.KIND_KEY))) {
        		String pythonCode = envelope.getString(AfterCalculatorSubmitTools.CODE_KEY);
        		if (pythonCode != null) {
        			try{
        				List<Map> runResult = this.runPythonCode(sessionid, pythonCode, lang);
        				result.setAnswer(runResult);
        			} catch (SessionCancelledException exp) {
        				throw exp;
        			} catch (Exception exp) {
        				log.error("python execution error",exp);
        				result.setAnswer(null);
        			}

        			if (envelope.containsKey(AfterCalculatorSubmitTools.DATA_REF_KEY)) {
        				try {
        					List<Map> dataRef = envelope.getJSONArray(AfterCalculatorSubmitTools.DATA_REF_KEY).toList(Map.class);
        					List<AfterCalculatorConsanguinity> consanguinityList = new ArrayList<AfterCalculatorConsanguinity>();
        					for (Map map : dataRef) {
						AfterCalculatorConsanguinity consanguinity = new AfterCalculatorConsanguinity();
						String output = null;
						if (map.get("output") != null && map.get("output") instanceof String && !"".equals(((String)map.get("output")).trim())) {
							output = ((String)map.get("output")).trim();
						}
						List<Source> sources = new ArrayList<Source>();
						if (map.get("input") != null && map.get("input") instanceof JSONArray) {
							JSONArray input = (JSONArray)map.get("input");
							for (int i = 0; i < input.size(); i++) {
								String inputStr = input.getString(i);
								if (inputStr != null && !"".equals(inputStr.trim())) {
									inputStr = inputStr.trim();
									if (inputStr.indexOf(".") > 2) {
										String indexStr = inputStr.substring(0, inputStr.indexOf(".")).trim();
										Integer index = null;
										try {
											index = Integer.parseInt(indexStr.substring(1, indexStr.length() - 1).trim());
										} catch (Exception e) {}
										if (index == null) {
											sources = null;
											break;
										}
										String inputKey = inputStr.substring(inputStr.indexOf(".") + 1).trim();
										if (!"".equals(inputKey)) {
											Source source = consanguinity.new Source();
											source.setSubQueryIndex(index);
											source.setInputKey(inputKey);
											sources.add(source);
										} else {
											sources = null;
											break;
										}
									} else {
										sources = null;
										break;
									}
								} else {
									sources = null;
									break;
								}
							}
						} else {
							sources = null;
						}
						if (output != null && sources != null) {
							consanguinity.setOutputKey(output);
							consanguinity.setSources(sources);
							consanguinity.setType(map.get("type") != null && map.get("type") instanceof String ? ((String)map.get("type")).trim() : "");
							consanguinity.setComment(map.get("comment") != null && map.get("comment") instanceof String ? ((String)map.get("comment")).trim() : "");
							consanguinityList.add(consanguinity);
						}
					}
                    result.setDataRef(consanguinityList);
                } catch (Exception e){
                    log.error("Error parsing the jsonDataRef returned by python",e);
                }
            }
        		}
        	}
        }
        
        return result;
		} finally {
			agentWorkspaceService.removeWorkspace(pySessionid);
		}
    }

    @Override
    public List<Map> runPythonCode(String sessionid, String pythonCode, String lang) throws Exception {
        try{
        	PythonExecuteResult result = pythonExecuteService.runPythonCode(sessionid, pythonCode, 2, lang);
        	String pythonOutput = result.getResult();
        	String errorMessage = result.getError();
        	if (errorMessage != null && !"".equals(errorMessage.trim())) {
        		throw new Exception(errorMessage);
        	}
            pythonOutput = pythonOutput.replaceAll(":\\s*NaN", ": null");
            log.info("[" + sessionid + "] pythonOutput:{}",pythonOutput);
            //Extract the JSON string with a regular expression
            String answerJSON = this.getAnswerJSON(pythonOutput);
            Map pythonOutputJsonMap = JSON.parseObject(answerJSON, Map.class);
            if(pythonOutputJsonMap.containsKey("answer")){
                Object answer = pythonOutputJsonMap.get("answer");
                if(answer instanceof List){
                    return (List<Map>) answer;
                }
            }

        } catch (SessionCancelledException exp) {
            throw exp;
        } catch (Exception exp){
            log.error(sessionid,exp);
            throw exp;
        }

        // Call python code
        return null;
    }

    @Override
    public String getAnswerJSON(String pythonOutput){
        Matcher matcherJSON = ANSWER_JSON_PATTERN.matcher(pythonOutput);
        if(matcherJSON.find()){
            String answerJSON = matcherJSON.group(1);
            return  answerJSON;
        } else {
            return null;
        }
    }
    
    private File getPythonFile(String sessionId) {
    	File pythonFile = new File(pythonPath, sessionId + ".py");
    	return pythonFile;
    }
    
    @Override
    public String getPythonCode(String sessionId) {
    	String code = "";
    	FileInputStream fis = null;
    	try {
    		File pythonFile = getPythonFile(sessionId);
    		fis = new FileInputStream(pythonFile);
    		code = new String(fis.readAllBytes(), "utf-8");
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    	} finally {
    		if (fis != null) {
    			try {
    				fis.close();
    			} catch (Exception e) {
    				log.error(e.getMessage(), e);
    			}
    		}
    	}
    	return code;
    }




}
