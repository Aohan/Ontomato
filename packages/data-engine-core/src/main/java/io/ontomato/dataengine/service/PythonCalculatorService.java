package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.bean.PythonCalculatorResult;

public interface PythonCalculatorService {
	
    public PythonCalculatorResult calculate(String sessionid, String calculateQuestion,List<Map> jsonSchema, String originSessionId, String lang, String domainId);

    public List<Map> runPythonCode(String sessionid, String pythonCode, String lang) throws Exception;
    
    public String getAnswerJSON(String pythonOutput);

    public String getPythonCode(String sessionId);
    
}
