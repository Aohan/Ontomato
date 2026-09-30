package io.ontomato.dataengine.service;

import java.util.List;

/**
 * Permission targets chosen for one schema import.
 * The list is fixed when the import is prepared and is not stored on a shared service.
 */
public final class SchemaImportAuthorization {

    private final List<String> postIds;

    public SchemaImportAuthorization(List<String> postIds) {
        this.postIds = List.copyOf(postIds);
    }

    public List<String> postIds() {
        return postIds;
    }
}
