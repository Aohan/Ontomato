package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Split equivalence grouper
 * <p>
 * Determines equivalence among a group of Split-format JSON strings and groups them.
 * Generates a signature by normalizing the JSON structure; Splits with the same signature are considered equivalent.
 *
 * Equivalence rules:
 * 1. Different element counts in subQueries -> not equivalent
 * 2. finalCalculation has a value vs empty string -> not equivalent (different description values are considered equivalent)
 * 3. Different order of elements within any Json list -> equivalent
 * 4. Different path counts in subQueries[*] -> not equivalent
 * 5. Different subQueries[*].path[*].source/target -> not equivalent
 * 6. Different node counts in subQueries[*] -> not equivalent
 * 7. Different subQueries[*].nodes[*].node -> not equivalent
 * 8. Different logical expression order in subQueries[*].nodes[*].filters but same logic -> equivalent
 * 9. Different logical expressions in subQueries[*].nodes[*].filters -> not equivalent
 * 10. Different items in subQueries[*].nodes[*].select -> not equivalent
 * 11. Items in subQueries[*].nodes[*].select differ only in order -> equivalent
 * 12. filter_source is ignored and not compared -> equivalent
 * 13. select_reason is ignored and not compared -> equivalent
 */
public class SplitGrouper {

    private static final Pattern JSON_PATTERN = Pattern.compile("```json\\s*\n([\\s\\S]*?)```", Pattern.MULTILINE);

    /**
     * Groups a list of Split JSON strings by equivalence
     * <p>
     * Generates a normalized signature for each Split JSON; those with the same signature are grouped together.
     * The grouping result is sorted in descending order of the number of elements in each group.
     *
     * @param splitJsonList list of Split JSON strings, each element is a complete Split result
     * @return grouping result, each group stores the original indexes (starting from 0), sorted in descending order of the number of elements in each group
     */
    public List<List<Integer>> group(List<String> splitJsonList) {
        // return an empty result directly for an empty list
        if (splitJsonList == null || splitJsonList.isEmpty()) {
            return Collections.emptyList();
        }

        // signature -> index list mapping, LinkedHashMap preserves insertion order
        Map<String, List<Integer>> signatureMap = new LinkedHashMap<>();

        // iterate over each Split JSON, generate a signature and group it
        for (int i = 0; i < splitJsonList.size(); i++) {
            String splitRet = splitJsonList.get(i);
            String jsonResult = this.getJsonResult(splitRet);
            String signature = generateSignature(jsonResult);
            signatureMap.computeIfAbsent(signature, k -> new ArrayList<>()).add(i);
        }

        // extract the grouping result, sorted in descending order of the number of elements in each group
        List<List<Integer>> result = new ArrayList<>(signatureMap.values());
        result.sort((a, b) -> Integer.compare(b.size(), a.size()));
        return result;
    }

    private String getJsonResult(String splitRet){
        Matcher jsonMatcher = this.JSON_PATTERN.matcher(splitRet);
        String jsonResult = "";
        if(jsonMatcher.find()){
            jsonResult = jsonMatcher.group(1);
        }
        return jsonResult;
    }

    /**
     * Generates a normalized signature for a Split JSON
     * <p>
     * Parses and normalizes the JSON, then serializes it to a JSON string as the signature.
     * Splits with the same signature are considered equivalent.
     *
     * @param json original Split JSON string
     * @return normalized JSON string signature
     */
    private String generateSignature(String json) {
        JSONObject obj = JSON.parseObject(json);
        if (obj == null) {
            return "";
        }
        JSONObject normalized = normalizeSplit(obj);
        return normalized.toJSONString();
    }

    /**
     * Normalizes a Split JSON object
     * <p>
     * Keeps only the two fields subQueries and finalCalculation (if it has a value),
     * and ignores fields such as question, filter_source and select_reason that do not affect equivalence.
     *
     * @param split original Split JSON object
     * @return normalized JSON object
     */
    private JSONObject normalizeSplit(JSONObject split) {
        JSONObject result = new JSONObject();

        // normalize the sub-query list
        JSONArray subQueries = split.getJSONArray("subQueries");
        if (subQueries != null) {
            result.put("subQueries", normalizeSubQueries(subQueries));
        }

        // finalCalculation only distinguishes has value / no value; different descriptions are considered equivalent
        String finalCalculation = split.getString("finalCalculation");
        if (finalCalculation != null && !finalCalculation.isEmpty()) {
            result.put("finalCalculation", "__HAS_VALUE__");
        }

        return result;
    }

    /**
     * Normalizes the sub-query list
     * <p>
     * Normalizes each sub-query, then sorts them by JSON string,
     * ensuring that a different sub-query order is still judged equivalent.
     *
     * @param subQueries original sub-query array
     * @return normalized and sorted sub-query array
     */
    private JSONArray normalizeSubQueries(JSONArray subQueries) {
        List<JSONObject> normalized = new ArrayList<>();
        for (int i = 0; i < subQueries.size(); i++) {
            JSONObject sq = subQueries.getJSONObject(i);
            if (sq != null) {
                normalized.add(normalizeSubQuery(sq));
            }
        }
        // sort by normalized JSON string to eliminate sub-query order differences
        normalized.sort(Comparator.comparing(JSON::toJSONString));
        JSONArray result = new JSONArray();
        for (JSONObject sq : normalized) {
            result.add(sq);
        }
        return result;
    }

    /**
     * Normalizes a single sub-query
     * <p>
     * Keeps only path and nodes in subgraph, and ignores fields such as subQuestion, C_Step and classes.
     *
     * @param subQuery original sub-query object
     * @return normalized sub-query object
     */
    private JSONObject normalizeSubQuery(JSONObject subQuery) {
        JSONObject result = new JSONObject();

        JSONObject subgraph = subQuery.getJSONObject("subgraph");
        if (subgraph != null) {
            JSONObject normalizedSubgraph = new JSONObject();

            // normalize the path relationships
            JSONArray path = subgraph.getJSONArray("path");
            if (path != null) {
                normalizedSubgraph.put("path", normalizePath(path));
            }

            // normalize the node list
            JSONArray nodes = subgraph.getJSONArray("nodes");
            if (nodes != null) {
                normalizedSubgraph.put("nodes", normalizeNodes(nodes));
            }

            result.put("subgraph", normalizedSubgraph);
        }

        return result;
    }

    /**
     * Normalizes the path relationship list
     * <p>
     * Keeps only source and target for each path, and sorts by source|target,
     * ensuring that a different path order is judged equivalent.
     *
     * @param path original path array
     * @return normalized and sorted path array
     */
    private JSONArray normalizePath(JSONArray path) {
        List<JSONObject> paths = new ArrayList<>();
        for (int i = 0; i < path.size(); i++) {
            JSONObject p = path.getJSONObject(i);
            JSONObject normalized = new JSONObject();
            // keep only source and target, ignoring other fields such as relation
            normalized.put("source", p.getString("source"));
            normalized.put("target", p.getString("target"));
            paths.add(normalized);
        }
        // sort by source|target to eliminate path order differences
        paths.sort(Comparator.comparing(
                (JSONObject p) -> p.getString("source") + "|" + p.getString("target")));
        JSONArray result = new JSONArray();
        for (JSONObject p : paths) {
            result.add(p);
        }
        return result;
    }

    /**
     * Normalizes the node list
     * <p>
     * Keeps only node, filters (normalized) and select (normalized) for each node,
     * and sorts by node name, ensuring that a different node order is judged equivalent.
     *
     * @param nodes original node array
     * @return normalized and sorted node array
     */
    private JSONArray normalizeNodes(JSONArray nodes) {
        List<JSONObject> nodeList = new ArrayList<>();
        for (int i = 0; i < nodes.size(); i++) {
            nodeList.add(normalizeNode(nodes.getJSONObject(i)));
        }
        // sort by node name to eliminate node order differences
        nodeList.sort(Comparator.comparing(n -> n.getString("node")));
        JSONArray result = new JSONArray();
        for (JSONObject n : nodeList) {
            result.add(n);
        }
        return result;
    }

    /**
     * Normalizes a single node
     * <p>
     * Keeps only node (class path), filters (normalized filter conditions) and select (normalized output fields),
     * and ignores descriptive fields such as filter_source and select_reason.
     *
     * @param node original node object
     * @return normalized node object
     */
    private JSONObject normalizeNode(JSONObject node) {
        JSONObject result = new JSONObject();
        result.put("node", node.getString("node"));
        // normalize the filter condition expression
        result.put("filters", normalizeFilters(node.getString("filters")));
        // normalize the select field list
        result.put("select", normalizeSelect(node.getString("select")));
        return result;
    }

    /**
     * Normalizes the select field list
     * <p>
     * Splits the comma-separated field list, trims whitespace, sorts it and joins it back together,
     * ensuring that a different select field order is judged equivalent.
     * An empty string is treated as no select.
     *
     * @param select original select string, e.g. "name, account, age"
     * @return normalized select string, e.g. "account,age,name"
     */
    private String normalizeSelect(String select) {
        if (select == null || select.trim().isEmpty()) {
            return "";
        }
        String[] fields = select.split(",");
        for (int i = 0; i < fields.length; i++) {
            fields[i] = fields[i].trim();
        }
        // sort by field name to eliminate field order differences
        Arrays.sort(fields);
        return String.join(",", fields);
    }

    // ==================== filter condition expression parser ====================

    /**
     * Normalizes the filter condition expression
     * <p>
     * Parses the filters string into a syntax tree, then outputs a normalized expression string.
     * The normalization includes: sorting conditions inside AND/OR by field name, sorting the values of the IN operator, etc.
     * An empty string is treated as no filter conditions.
     *
     * @param filters original filter condition string, e.g. "status = 'employed' AND age <= 35"
     * @return normalized filter condition expression
     */
    private String normalizeFilters(String filters) {
        if (filters == null || filters.trim().isEmpty()) {
            return "";
        }
        String expr = filters.trim();
        // lexical analysis: split the expression into a Token sequence
        List<Token> tokens = tokenize(expr);
        if (tokens.isEmpty()) {
            return "";
        }
        // syntax analysis: build the expression syntax tree and output the normalized expression
        int[] pos = new int[]{0};
        FilterNode root = parseOr(tokens, pos);
        return root.toCanonical();
    }

    // ==================== lexer ====================

    /**
     * Token type enumeration
     * AND/OR: logical operators
     * LPAREN/RPAREN: left and right parentheses
     * CONDITION: single condition expression
     */
    private static class Token {
        enum Type { AND, OR, LPAREN, RPAREN, CONDITION }
        final Type type;
        final String value; // only the CONDITION type has a value

        Token(Type type, String value) {
            this.type = type;
            this.value = value;
        }
    }

    /**
     * Lexical analysis: splits the filter condition string into a Token sequence
     * <p>
     * Recognizes the AND and OR keywords, parentheses, and single condition expressions.
     * Supports handling single-quoted strings and nested parentheses.
     *
     * @param expr filter condition expression
     * @return Token sequence
     */
    private List<Token> tokenize(String expr) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        int len = expr.length();

        while (i < len) {
            char c = expr.charAt(i);

            // skip whitespace characters
            if (Character.isWhitespace(c)) {
                i++;
                continue;
            }

            // recognize the AND keyword
            if (matchesKeywordAt(expr, i, "AND")) {
                tokens.add(new Token(Token.Type.AND, null));
                i += 3;
                continue;
            }

            // recognize the OR keyword
            if (matchesKeywordAt(expr, i, "OR")) {
                tokens.add(new Token(Token.Type.OR, null));
                i += 2;
                continue;
            }

            // recognize the left parenthesis
            if (c == '(') {
                tokens.add(new Token(Token.Type.LPAREN, null));
                i++;
                continue;
            }

            // recognize the right parenthesis
            if (c == ')') {
                tokens.add(new Token(Token.Type.RPAREN, null));
                i++;
                continue;
            }

            // recognize a single condition expression (e.g. "status = 'employed'")
            int start = i;
            while (i < len) {
                c = expr.charAt(i);

                // skip the string inside single quotes (e.g. 'employed')
                if (c == '\'') {
                    i++;
                    while (i < len && expr.charAt(i) != '\'') {
                        i++;
                    }
                    if (i < len) {
                        i++;
                    }
                    continue;
                }

                // skip the content inside nested parentheses (e.g. (degree_level != 'PhD' OR degree_level IS NULL))
                if (c == '(') {
                    int depth = 1;
                    i++;
                    while (i < len && depth > 0) {
                        if (expr.charAt(i) == '(') {
                            depth++;
                        } else if (expr.charAt(i) == ')') {
                            depth--;
                        }
                        i++;
                    }
                    continue;
                }

                // stop the current condition expression on an AND/OR keyword
                if (matchesKeywordAt(expr, i, "AND") || matchesKeywordAt(expr, i, "OR")) {
                    break;
                }

                // stop the current condition expression on a right parenthesis
                if (c == ')') {
                    break;
                }

                i++;
            }

            String cond = expr.substring(start, i).trim();
            if (!cond.isEmpty()) {
                tokens.add(new Token(Token.Type.CONDITION, cond));
            }
        }

        return tokens;
    }

    /**
     * Checks whether the keyword matches at the specified position in the expression
     * <p>
     * Ensures a whole word is matched rather than part of another word.
     * For example: "AND" should not match the "AND" in "STANDARD".
     *
     * @param expr    expression string
     * @param i       current position
     * @param keyword keyword
     * @return whether it matches
     */
    private boolean matchesKeywordAt(String expr, int i, String keyword) {
        int kwLen = keyword.length();
        // not enough length
        if (i + kwLen > expr.length()) {
            return false;
        }
        // content does not match
        if (!expr.substring(i, i + kwLen).equalsIgnoreCase(keyword)) {
            return false;
        }
        // the character after must not be a letter or digit (to prevent partial matches)
        if (i + kwLen < expr.length() && Character.isLetterOrDigit(expr.charAt(i + kwLen))) {
            return false;
        }
        // the character before must not be a letter or digit (to prevent partial matches)
        if (i > 0 && Character.isLetterOrDigit(expr.charAt(i - 1))) {
            return false;
        }
        return true;
    }

    // ==================== recursive descent parser ====================

    /**
     * Parses an OR expression
     * <p>
     * Grammar: OR expression = AND expression ( OR AND expression )*
     * OR has the lowest precedence: parse AND expressions first, then merge them with OR.
     */
    private FilterNode parseOr(List<Token> tokens, int[] pos) {
        FilterNode left = parseAnd(tokens, pos);
        while (pos[0] < tokens.size() && tokens.get(pos[0]).type == Token.Type.OR) {
            pos[0]++; // skip OR
            FilterNode right = parseAnd(tokens, pos);
            left = mergeOr(left, right);
        }
        return left;
    }

    /**
     * Parses an AND expression
     * <p>
     * Grammar: AND expression = primary expression ( AND primary expression )*
     * AND has higher precedence than OR.
     */
    private FilterNode parseAnd(List<Token> tokens, int[] pos) {
        FilterNode left = parsePrimary(tokens, pos);
        while (pos[0] < tokens.size() && tokens.get(pos[0]).type == Token.Type.AND) {
            pos[0]++; // skip AND
            FilterNode right = parsePrimary(tokens, pos);
            left = mergeAnd(left, right);
        }
        return left;
    }

    /**
     * Parses a primary expression
     * <p>
     * A primary expression can be a parenthesized sub-expression or a single condition expression.
     */
    private FilterNode parsePrimary(List<Token> tokens, int[] pos) {
        Token token = tokens.get(pos[0]);
        // parenthesized expression: recursively parse the inner content
        if (token.type == Token.Type.LPAREN) {
            pos[0]++; // skip the left parenthesis
            FilterNode inner = parseOr(tokens, pos);
            pos[0]++; // skip the right parenthesis
            return inner;
        }
        // single condition expression
        if (token.type == Token.Type.CONDITION) {
            pos[0]++;
            return parseCondition(token.value);
        }
        throw new IllegalArgumentException("Unexpected token: " + token.type);
    }

    /**
     * Merges AND nodes
     * <p>
     * Merges the children of the left and right AND nodes (or ordinary nodes) into one AndNode,
     * and sorts them by normalized string to eliminate condition order differences inside AND.
     */
    private FilterNode mergeAnd(FilterNode left, FilterNode right) {
        List<FilterNode> children = new ArrayList<>();
        collectChildren(left, children);
        collectChildren(right, children);
        // sort by normalized string to make the order of conditions inside AND irrelevant
        children.sort(Comparator.comparing(FilterNode::toCanonical));
        return new AndNode(children);
    }

    /**
     * Merges OR nodes
     * <p>
     * Merges the children of the left and right OR nodes (or ordinary nodes) into one OrNode,
     * and sorts them by normalized string to eliminate condition order differences inside OR.
     */
    private FilterNode mergeOr(FilterNode left, FilterNode right) {
        List<FilterNode> children = new ArrayList<>();
        collectChildren(left, children);
        collectChildren(right, children);
        // sort by normalized string to make the order of conditions inside OR irrelevant
        children.sort(Comparator.comparing(FilterNode::toCanonical));
        return new OrNode(children);
    }

    /**
     * Collects the child nodes of a node
     * <p>
     * If the node is an AndNode/OrNode, unfold its children;
     * otherwise add the node directly.
     * Used to flatten nested structures when merging logic.
     */
    private void collectChildren(FilterNode node, List<FilterNode> out) {
        if (node instanceof AndNode) {
            out.addAll(((AndNode) node).children);
        } else if (node instanceof OrNode) {
            out.addAll(((OrNode) node).children);
        } else {
            out.add(node);
        }
    }

    // ==================== condition expression parsing ====================

    /**
     * Normalizes a field name
     * <p>
     * field name, field name(field annotation) and field annotation(field name) are equivalent fields.
     * For example: status, status(person status) and person status(status) are equivalent, and all normalize to status.
     * Extraction rule: if the field name contains parentheses, take the English identifier part (letters/digits/underscore) inside as the canonical name.
     */
    private String normalizeFieldName(String rawField) {
        rawField = rawField.trim();
        int parenStart = rawField.indexOf('(');
        int parenEnd = rawField.lastIndexOf(')');
        if (parenStart >= 0 && parenEnd > parenStart) {
            String part1 = rawField.substring(0, parenStart).trim();
            String part2 = rawField.substring(parenStart + 1, parenEnd).trim();
            if (part1.matches("[a-zA-Z_][a-zA-Z0-9_]*")) {
                return part1;
            }
            if (part2.matches("[a-zA-Z_][a-zA-Z0-9_]*")) {
                return part2;
            }
            return part2;
        }
        return rawField;
    }

    /**
     * Parses a single condition expression
     * <p>
     * Supported operators: IS NULL, IS NOT NULL, IN, LIKE, >=, <=, !=, =, >, <
     * Sorts the value list of the IN operator to eliminate value order differences.
     *
     * @param cond original condition string, e.g. "status = 'employed'"
     * @return normalized condition node
     */
    private ConditionNode parseCondition(String cond) {
        cond = cond.trim();

        String upper = cond.toUpperCase();

        // parse IS NOT NULL
        if (upper.endsWith(" IS NOT NULL")) {
            String field = normalizeFieldName(cond.substring(0, cond.length() - " IS NOT NULL".length()));
            return new ConditionNode(field, "IS NOT NULL", null);
        }

        // parse IS NULL
        if (upper.endsWith(" IS NULL")) {
            String field = normalizeFieldName(cond.substring(0, cond.length() - " IS NULL".length()));
            return new ConditionNode(field, "IS NULL", null);
        }

        // parse the IN operator
        int inIdx = findOperatorIndex(cond, "IN");
        if (inIdx >= 0) {
            String field = normalizeFieldName(cond.substring(0, inIdx));
            String valueStr = cond.substring(inIdx + 2).trim();
            if (valueStr.startsWith("(") && valueStr.endsWith(")")) {
                // extract the value list inside the parentheses, sort it and join it back
                valueStr = valueStr.substring(1, valueStr.length() - 1).trim();
                String[] values = valueStr.split(",");
                for (int j = 0; j < values.length; j++) {
                    values[j] = values[j].trim();
                }
                // sort the IN array values to eliminate value order differences
                Arrays.sort(values);
                String sortedValue = "(" + String.join(",", values) + ")";
                return new ConditionNode(field, "IN", sortedValue);
            }
        }

        // parse the LIKE operator
        int likeIdx = findOperatorIndex(cond, "LIKE");
        if (likeIdx >= 0) {
            String field = normalizeFieldName(cond.substring(0, likeIdx));
            String value = cond.substring(likeIdx + 4).trim();
            return new ConditionNode(field, "LIKE", value);
        }

        // parse comparison operators: >=, <=, !=, =, >, <
        String[] operators = {">=", "<=", "!=", "=", ">", "<"};
        for (String op : operators) {
            int idx = cond.indexOf(op);
            if (idx > 0) {
                String field = normalizeFieldName(cond.substring(0, idx));
                String value = cond.substring(idx + op.length()).trim();
                return new ConditionNode(field, op, value);
            }
        }

        // unrecognized expression, return as is
        return new ConditionNode(cond, "", "");
    }

    /**
     * Finds the position of an operator in the condition string
     * <p>
     * Ensures the operator is a standalone word and not part of a field name or value.
     * For example: "IN" should not match the "IN" in "INTEREST".
     *
     * @param cond     condition string
     * @param operator operator
     * @return position of the operator, or -1 if not found
     */
    private int findOperatorIndex(String cond, String operator) {
        String upper = cond.toUpperCase();
        int idx = upper.indexOf(operator);
        if (idx < 0) {
            return -1;
        }
        // there must be content (the field name) before the operator
        String before = cond.substring(0, idx).trim();
        if (before.isEmpty()) {
            return -1;
        }
        // the character right after the operator must not be a letter or digit
        if (idx + operator.length() < cond.length()
                && Character.isLetterOrDigit(cond.charAt(idx + operator.length()))) {
            return -1;
        }
        return idx;
    }

    // ==================== filter node types ====================

    /**
     * Filter condition node interface
     * Each node can output a normalized string representation
     */
    private interface FilterNode {
        String toCanonical();
    }

    /**
     * Single condition node
     * <p>
     * Represents an atomic condition of the form "field operator value".
     * For example: "status = 'employed'", "age >= 35", "degree_level IS NULL"
     */
    private static class ConditionNode implements FilterNode {
        final String field;    // field name
        final String operator; // operator
        final String value;    // value (null for IS NULL)

        ConditionNode(String field, String operator, String value) {
            this.field = field;
            this.operator = operator;
            this.value = value;
        }

        /**
         * Outputs the normalized condition string
         * value is not output for IS NULL/IS NOT NULL
         */
        public String toCanonical() {
            if (operator.equals("IS NULL") || operator.equals("IS NOT NULL")) {
                return field + " " + operator;
            }
            if (operator.isEmpty()) {
                return field;
            }
            return field + " " + operator + " " + value;
        }
    }

    /**
     * AND logic node
     * <p>
     * Contains multiple child conditions, and the relationship between child conditions is AND.
     * When output in normalized form, the child conditions are already sorted by field name.
     */
    private static class AndNode implements FilterNode {
        final List<FilterNode> children;

        AndNode(List<FilterNode> children) {
            this.children = children;
        }

        /**
         * Outputs a normalized string in the format "child1 AND child2 AND ..."
         */
        public String toCanonical() {
            return children.stream().map(FilterNode::toCanonical).collect(Collectors.joining(" AND "));
        }
    }

    /**
     * OR logic node
     * <p>
     * Contains multiple child conditions, and the relationship between child conditions is OR.
     * When output in normalized form, the child conditions are already sorted by field name and wrapped in outer parentheses.
     */
    private static class OrNode implements FilterNode {
        final List<FilterNode> children;

        OrNode(List<FilterNode> children) {
            this.children = children;
        }

        /**
         * Outputs a normalized string in the format "(child1 OR child2 OR ...)"
         */
        public String toCanonical() {
            return "(" + children.stream().map(FilterNode::toCanonical).collect(Collectors.joining(" OR ")) + ")";
        }
    }
}