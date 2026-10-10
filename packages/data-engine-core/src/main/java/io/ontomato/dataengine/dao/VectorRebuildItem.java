package io.ontomato.dataengine.dao;

/** One stored row awaiting re-vectorization: its id and the exact text the write path embeds. */
public class VectorRebuildItem {

    private final String id;
    private final String text;

    public VectorRebuildItem(String id, String text) {
        this.id = id;
        this.text = text;
    }

    public String getId() {
        return id;
    }

    public String getText() {
        return text;
    }

}
