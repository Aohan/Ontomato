package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import com.alibaba.fastjson2.JSONObject;

/**
 * The pattern of a like condition that names an escape character ({@code "escape"}): {@code %} and {@code _} are
 * wildcards, and the escape character makes the next character literal, so text bound into a pattern (such as
 * a user parameter) is matched as data. Each adapter renders it in its engine's own syntax with
 * {@link #render}; a like condition without an escape character keeps each adapter's original handling.
 */
public final class LikePattern {

	private static final Object ANY = new Object();
	private static final Object ONE = new Object();

	/** {@link #ANY}, {@link #ONE} or a literal {@link Character}. */
	private final List<Object> tokens;

	private LikePattern(List<Object> tokens) {
		this.tokens = tokens;
	}

	/** Whether the condition carries an escape character and so must be rendered through this class. */
	public static boolean escaped(JSONObject condition) {
		return condition.get("escape") != null;
	}

	/**
	 * Parses the condition's pattern. With {@code containsWhenUnanchored}, a pattern that neither starts nor ends
	 * with a {@code %} wildcard is wrapped in {@code %} on both sides, as the read paths do for a bare value.
	 */
	public static LikePattern of(JSONObject condition, boolean containsWhenUnanchored) {
		// Checked here, at every adapter's entry: only one escape character has a meaning.
		if (!(condition.get("escape") instanceof String escapeText) || escapeText.length() != 1
				|| !(condition.get("value") instanceof String value)) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"conditions.properties", "the like condition on '" + condition.getString("field")
							+ "' needs a text value and an escape of exactly one character");
		}
		char escape = escapeText.charAt(0);
		List<Object> tokens = new ArrayList<>();
		for (int i = 0; i < value.length(); i++) {
			char c = value.charAt(i);
			if (c == escape) {
				if (++i == value.length()) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
							"conditions.properties", "the like pattern of '" + condition.getString("field")
									+ "' ends with its escape character");
				}
				tokens.add(value.charAt(i));
			} else {
				tokens.add(c == '%' ? ANY : c == '_' ? ONE : c);
			}
		}
		if (containsWhenUnanchored && (tokens.isEmpty() || (tokens.getFirst() != ANY && tokens.getLast() != ANY))) {
			tokens.addFirst(ANY);
			tokens.addLast(ANY);
		}
		return new LikePattern(tokens);
	}

	/** Whether any literal character is one of {@code characters}. */
	public boolean hasLiteral(String characters) {
		return tokens.stream().anyMatch(token -> token instanceof Character c && characters.indexOf(c) >= 0);
	}

	/** The pattern in an engine's syntax: its two wildcards and how it writes one literal character. */
	public String render(String any, String one, Function<Character, String> literal) {
		StringBuilder pattern = new StringBuilder();
		for (Object token : tokens) {
			pattern.append(token == ANY ? any : token == ONE ? one : literal.apply((Character) token));
		}
		return pattern.toString();
	}

	/**
	 * The pattern for a SQL {@code LIKE ... ESCAPE '!'}: literal {@code %}, {@code _}, {@code !} and the
	 * engine's other pattern characters are preceded by {@code !}. {@code !} is used because it has no meaning in
	 * any string literal syntax, and only characters that need it are escaped, which Oracle and DB2 require.
	 */
	public String sql(String otherPatternCharacters) {
		String special = "%_!" + otherPatternCharacters;
		return render("%", "_", c -> special.indexOf(c) >= 0 ? "!" + c : String.valueOf(c));
	}
}
