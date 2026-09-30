package io.ontomato.dataengine.service.impl;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.SchemaImportAuthorization;
import io.ontomato.dataengine.service.SchemaPermissionService;

/**
 * Open-source edition has no permission table.
 * prepareImport returns an empty target; grantImport writes nothing.
 */
@Component
public class NoopSchemaPermissionService implements SchemaPermissionService {

    @Override
    public SchemaImportAuthorization prepareImport(User user) {
        return new SchemaImportAuthorization(List.of());
    }

    @Override
    public void grantImport(SchemaImportAuthorization authorization, List<Map<String, Object>> classDefs) {
    }
}
