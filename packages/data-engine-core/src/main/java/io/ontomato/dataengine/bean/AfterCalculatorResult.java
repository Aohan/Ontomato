package io.ontomato.dataengine.bean;

import java.util.List;
import java.util.Map;

public class AfterCalculatorResult {

    private List<Map> answer;
    private String userMessage;
    private String logic;
    private List<AfterCalculatorConsanguinity> dataRef;
    public List<Map> getAnswer() {
        return answer;
    }
    public void setAnswer(List<Map> answer) {
        this.answer = answer;
    }
    public String getUserMessage() {
        return userMessage;
    }
    public void setUserMessage(String userMessage) {
        this.userMessage = userMessage;
    }
    public String getLogic() {
        return logic;
    }
    public void setLogic(String logic) {
        this.logic = logic;
    }
    public List<AfterCalculatorConsanguinity> getDataRef() {
        return dataRef;
    }

    public void setDataRef(List<AfterCalculatorConsanguinity> dataRef) {
        this.dataRef = dataRef;
    }
}
