package io.ontomato.dataengine.service.vector;

import lombok.Data;

/** The vectorRebuildStatus response data: the rebuild rule plus the latest in-memory run state. */
@Data
public class VectorRebuildStatus {

    private boolean needed;
    private boolean running;
    private int total;
    private int done;
    private String error;

}
