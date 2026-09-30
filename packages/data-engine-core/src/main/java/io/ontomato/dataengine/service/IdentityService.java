package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * Abstract entry point for identity and permission resolution.
 *
 * <p>Both the open-source edition (no users) and the enterprise edition (users/roles/positions/permissions) provide the "current user" and the "current data permission" through this interface,
 * and business code only depends on this interface, without being aware of whether the underlying login is anonymous or sa-token.</p>
 */
public interface IdentityService {

    /**
     * Get the current user.
     *
     * @return The open-source edition always returns a non-null anonymous user; the enterprise edition may return null when not logged in.
     */
    User getCurrentUser();

    /**
     * Get the current user ID, returns null when not logged in.
     */
    String getCurrentUserId();

    /**
     * Get the current user's data permission (row/field-level filtering).
     *
     * <p>The open-source edition returns a "full, unfiltered" permission with fullData=true; the enterprise edition resolves it by role/position.</p>
     */
    UserDataPermission getCurrentUserDataPermission();
}
