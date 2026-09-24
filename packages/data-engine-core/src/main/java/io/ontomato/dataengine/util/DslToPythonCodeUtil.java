package io.ontomato.dataengine.util;

import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

public class DslToPythonCodeUtil {

	/** Maximum width of a single line (including indentation); expand when exceeded */
    private static final int MAX_WIDTH = 100;
    /** Indentation unit */
    private static final String INDENT_UNIT = "    ";
    /** Starting indentation level of the dsl variable in the template (1 level inside try) */
    private static final int BASE_LEVEL = 1;

    private static final String HEADER =
            "import sys\n" +
            "import json\n" +
            "import requests\n" +
            "import traceback\n" +
            "\n" +
            "def executeDsl(dsl: dict, userId: str, domainId: str) -> list:\n" +
            "    url = f\"http://127.0.0.1:{port}/dsl/execute\"\n" +
            "    resp = requests.post(url, json={\"dsl\": dsl, \"userId\": userId, \"domainId\": domainId}).json()\n" +
            "    error = resp.get(\"error\")\n" +
            "    if error:\n" +
            "        raise Exception(error)\n" +
            "    answer = resp[\"data\"][0]\n" +
            "    return answer.get(\"answer\", [])\n" +
            "\n" +
            "if len(sys.argv) > 2:\n" +
            "    userId = sys.argv[1]  # \"userId\"\n" +
            "    domainId = sys.argv[2]  # \"domainId\"\n" +
            "\n" +
            "try:\n";

    private static final String FOOTER =
            "    rows = executeDsl(dsl, userId, domainId)\n" +
            "    print(json.dumps({\"answer\": rows}, ensure_ascii=False))\n" +
            "except Exception as e:\n" +
            "    traceback.print_exc()\n";

    /**
     * Entry method: DSL -> Python code
     */
    public static String generate(JSONObject dsl, String port) {
        if (dsl == null) {
            dsl = new JSONObject();
        }
        String literal = render(dsl, BASE_LEVEL);
        StringBuilder sb = new StringBuilder();
        sb.append(HEADER.replace("{port}", port));
        sb.append(INDENT_UNIT).append("dsl = ").append(literal).append("\n");
        sb.append(FOOTER);
        return sb.toString();
    }

    // ------------------------------------------------------------------
    // Rendering logic
    // ------------------------------------------------------------------

    /**
     * @param level the indentation level of the current object (the indentation level of its closing brace)
     */
    private static String render(Object node, int level) {
        if (node instanceof Map) {
            return renderMap((Map<?, ?>) node, level);
        }
        if (node instanceof Iterable) {
            return renderList(toArray(node), level);
        }
        return scalar(node);
    }

    private static String renderMap(Map<?, ?> map, int level) {
        if (map.isEmpty()) {
            return "{}";
        }
        String compact = compact(map);
        int indentLen = level * INDENT_UNIT.length();
        // dict: single line if it fits or the structure is flat (sub-containers contain only scalars)
        if (indentLen + compact.length() <= MAX_WIDTH || isFlat(map)) {
            return compact;
        }
        String pad = indent(level + 1);
        StringBuilder sb = new StringBuilder("{\n");
        int i = 0, size = map.size();
        for (Map.Entry<?, ?> e : map.entrySet()) {
            sb.append(pad).append(quote(String.valueOf(e.getKey()))).append(": ")
              .append(render(e.getValue(), level + 1));
            if (++i < size) {
                sb.append(",");
            }
            sb.append("\n");
        }
        sb.append(indent(level)).append("}");
        return sb.toString();
    }

    private static String renderList(JSONArray arr, int level) {
        if (arr.isEmpty()) {
            return "[]";
        }
        String compact = compact(arr);
        int indentLen = level * INDENT_UNIT.length();
        boolean hasContainer = false;
        for (Object o : arr) {
            if (isContainer(o)) {
                hasContainer = true;
                break;
            }
        }
        // list: single line only when all elements are scalars and the width allows
        if (!hasContainer && indentLen + compact.length() <= MAX_WIDTH) {
            return compact;
        }
        String pad = indent(level + 1);
        StringBuilder sb = new StringBuilder("[\n");
        for (int i = 0; i < arr.size(); i++) {
            sb.append(pad).append(render(arr.get(i), level + 1));
            if (i < arr.size() - 1) {
                sb.append(",");
            }
            sb.append("\n");
        }
        sb.append(indent(level)).append("]");
        return sb.toString();
    }

    /** Single-line compact form */
    private static String compact(Object node) {
        if (node instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) node;
            StringBuilder sb = new StringBuilder("{");
            int i = 0;
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (i++ > 0) {
                    sb.append(", ");
                }
                sb.append(quote(String.valueOf(e.getKey()))).append(": ").append(compact(e.getValue()));
            }
            return sb.append("}").toString();
        }
        if (node instanceof Iterable) {
            JSONArray arr = toArray(node);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.size(); i++) {
                if (i > 0) {
                    sb.append(", ");
                }
                sb.append(compact(arr.get(i)));
            }
            return sb.append("]").toString();
        }
        return scalar(node);
    }

    /** Flat: its own sub-containers no longer contain containers */
    private static boolean isFlat(Object node) {
        for (Object v : values(node)) {
            if (isContainer(v)) {
                for (Object inner : values(v)) {
                    if (isContainer(inner)) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    private static Iterable<?> values(Object node) {
        if (node instanceof Map) {
            return ((Map<?, ?>) node).values();
        }
        if (node instanceof Iterable) {
            return (Iterable<?>) node;
        }
        return java.util.Collections.emptyList();
    }

    private static boolean isContainer(Object o) {
        return o instanceof Map || o instanceof Iterable;
    }

    private static JSONArray toArray(Object node) {
        if (node instanceof JSONArray) {
            return (JSONArray) node;
        }
        JSONArray arr = new JSONArray();
        for (Object o : (Iterable<?>) node) {
            arr.add(o);
        }
        return arr;
    }

    // ------------------------------------------------------------------
    // Scalars and strings
    // ------------------------------------------------------------------

    private static String scalar(Object v) {
        if (v == null) {
            return "None";
        }
        if (v instanceof Boolean) {
            return ((Boolean) v) ? "True" : "False";
        }
        if (v instanceof Number) {
            return v.toString();
        }
        return quote(String.valueOf(v));
    }

    /** Generate a Python string literal (keeps non-ASCII, equivalent to ensure_ascii=False) */
    private static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':  sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append("\"").toString();
    }

    private static String indent(int level) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < level; i++) {
            sb.append(INDENT_UNIT);
        }
        return sb.toString();
    }
    
}
