package io.ontomato.dataengine.bean;

import java.util.Date;

import lombok.Data;

@Data
public class OriginalQuestion {
    private String id;
    private String question;
    private Date startTime;
    private Date endTime;

    public OriginalQuestion() {
        super();
        this.startTime = new Date();
    }

    public void setId(String id) {
        this.id = id;
    }

    public void setEndTime(Date endTime) {
        this.endTime = endTime;
    }

}
