package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.core.bean.User;

/**
 * Data-permission step around a production schema import.
 *
 * <p>{@code prepareImport} selects the permission targets and clears them.
 * {@code grantImport} must use that same selection after the schema is written.
 * The selection belongs to the returned object, not to the service instance.</p>
 */
public interface SchemaPermissionService {

    SchemaImportAuthorization prepareImport(User user);

    void grantImport(SchemaImportAuthorization authorization, List<Map<String, Object>> classDefs);
}
