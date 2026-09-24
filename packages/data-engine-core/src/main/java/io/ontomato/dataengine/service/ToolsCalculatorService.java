package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.bean.ToolsCalculatorResult;

public interface ToolsCalculatorService {

    public ToolsCalculatorResult calculate(String sessionid, String calculateQuestion, List<Map> jsonSchema, String lang, String domainId);


}
