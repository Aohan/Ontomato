package io.ontomato.dataengine.dao;

import java.util.Date;
import java.util.List;

public class KnowledgeEntity {

    private String knowledgeID;
    private List<Float> knowledgeVector;

    // creator type: 0-system, 1-user
    private int creatorType;

    // status: 0-pending approval, 1-approved
    private int status;
    private String knowledgeTitle;
    private String knowledgeText;
    private Date modifyTime;

    private List<String> knowledgeTags;
    public List<String> getKnowledgeTags() {
        return knowledgeTags;
    }
    public void setKnowledgeTags(List<String> knowledgeTags) {
        this.knowledgeTags = knowledgeTags;
    }

    public String getKnowledgeID()
    {
        return knowledgeID;
    }
    public void setKnowledgeID(String knowledgeID)
    {
        this.knowledgeID = knowledgeID;
    }
    public List<Float> getKnowledgeVector()
    {
        return knowledgeVector;
    }
    public void setKnowledgeVector(List<Float> knowledgeVector)
    {
        this.knowledgeVector = knowledgeVector;
    }
    public String getKnowledgeTitle()
    {
        return knowledgeTitle;
    }
    public void setKnowledgeTitle(String knowledgeTitle)
    {
        this.knowledgeTitle = knowledgeTitle;
    }
    public String getKnowledgeText()
    {
        return knowledgeText;
    }
    public void setKnowledgeText(String knowledgeText)
    {
        this.knowledgeText = knowledgeText;
    }
    public int getCreatorType() {
        return creatorType;
    }

    public void setCreatorType(int creatorType) {
        this.creatorType = creatorType;
    }

    public int getStatus() {
        return status;
    }

    public void setStatus(int status) {
        this.status = status;
    }
    public Date getModifyTime() {
        return modifyTime;
    }

    public void setModifyTime(Date modifyTime) {
        this.modifyTime = modifyTime;
    }
}
