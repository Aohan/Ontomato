package io.ontomato.dataengine.service.sys.bean.permission;

import java.util.HashSet;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Set;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FieldPermission {
    /**
     * Table/class name
     */
    String className;
    /**
     * Visible fields (columns visible to the user)
     */
    Set<String> visibleFields = new HashSet<>();
    /**
     * Group-only fields (columns that can only be used for grouping operations)
     */
    Set<String> groupableColumns = new HashSet<>();

    public FieldPermission(String className) {
        super();
        this.className = className;
    }

    public void mergePermission(String permission) {
        if (SystemUtils.isEmpty(permission)) {
            return;
        }
        parse(permission).forEach((name, lv) -> {
            if (lv == 1) {
                visibleFields.add(name);
            } else if (lv == 2) {
                groupableColumns.add(name);
            }
        });
    }

    public boolean isEmpty() {
        return visibleFields.isEmpty() && groupableColumns.isEmpty();
    }

    /**
     * Validation before writing. Shares {@link #parse} with {@link #mergePermission}, ensuring that whatever can be stored can definitely be read back.
     */
    public static void validate(String className, String permission) {
        try {
            parse(permission);
        } catch (Exception error) {
            throw new ServiceException("Field permission is not a valid JSON object: className=" + className, error);
        }
    }

    /**
     * The single parsing rule for field permission: a JSON object whose keys are field names and whose values are levels (0=no permission 1=visible 2=group only).
     */
    private static Map<String, Integer> parse(String permission) {
        JSONObject object = JSON.parseObject(permission);
        if (object == null) {
            throw new IllegalArgumentException("Field permission is not a JSON object");
        }
        Map<String, Integer> levels = new LinkedHashMap<>();
        for (String name : object.keySet()) {
            levels.put(name, object.getIntValue(name));
        }
        return levels;
    }

}
