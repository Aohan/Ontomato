package io.ontomato.dataengine.dao;

import java.util.Date;
import java.util.List;

public class BussinessExampleEntity {
    private String exampleID;
    private String exampleQuestion;
    private String exampleA;
    private String exampleB;
    private String exampleC;
    private String exampleImportant;

    // status: 0-pending approval, 1-approved
    private int status;

    private List<Float> exampleVector;

    private Date modifyTime;


    public String getExampleID() {
        return exampleID;
    }

    public void setExampleID(String exampleID) {
        this.exampleID = exampleID;
    }

    public String getExampleQuestion() {
        return exampleQuestion;
    }

    public void setExampleQuestion(String exampleQuestion) {
        this.exampleQuestion = exampleQuestion;
    }

    public String getExampleA() {
        return exampleA;
    }

    public void setExampleA(String exampleA) {
        this.exampleA = exampleA;
    }

    public String getExampleB() {
        return exampleB;
    }

    public void setExampleB(String exampleB) {
        this.exampleB = exampleB;
    }

    public String getExampleC() {
        return exampleC;
    }

    public void setExampleC(String exampleC) {
        this.exampleC = exampleC;
    }

    public String getExampleImportant() {
        return exampleImportant;
    }

    public void setExampleImportant(String exampleImportant) {
        this.exampleImportant = exampleImportant;
    }

    public int getStatus() {
        return status;
    }

    public void setStatus(int status) {
        this.status = status;
    }

    public List<Float> getExampleVector() {
        return exampleVector;
    }
    public void setExampleVector(List<Float> exampleVector) {
        this.exampleVector = exampleVector;
    }

    public Date getModifyTime() {
        return modifyTime;
    }

    public void setModifyTime(Date modifyTime) {
        this.modifyTime = modifyTime;
    }
}
