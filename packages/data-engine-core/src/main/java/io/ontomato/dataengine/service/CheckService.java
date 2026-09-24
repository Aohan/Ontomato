package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AfterCalculatorEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation;

public interface CheckService {

	public void addQuestion(String sessionId, String question, int subQuerySize, int afterCalculateSize, String lang, String domainId);
	
	public void fromDslToLogicText(String sessionId, int subQueryIndex, String dslStr, Map<String, Object> jsonRule, String lang, String domainId);
	
	public void fromAfterCalculateLogicToLogicText(String sessionId, int afterCalculateIndex, String afterCalculateLogic, List<String> cacheFilePaths);
	
	public List<JSONObject> queryBySessionId(String sessionId, String sseId, Long timeout);
	
	public void evaluateQuestionSpliter(
			String sessionId, 
			String question,
			String userMessage,
			String userMessageWithoutExample,
			JSONObject answerObj,
			String domainId);
	
	public void evaluateDslCooker(
			DslCookerEvaluation evaluation,
			int index,
			String domainId);
	
	public DslCookerEvaluation getDslCookerEvaluation(String sessionId, Integer index);
	
	public void evaluateAfterCalculator(AfterCalculatorEvaluation evaluation, String domainId);
	
}
