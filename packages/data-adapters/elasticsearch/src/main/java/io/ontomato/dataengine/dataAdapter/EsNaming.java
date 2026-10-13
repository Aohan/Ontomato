package io.ontomato.dataengine.dataAdapter;

import java.util.Locale;

/**
 * Physical index naming for the Elasticsearch/OpenSearch adapter.
 *
 * <p>The engine forbids what a business class name may carry: indices are lower-case only,
 * may not contain {@code \ / * ? " < > |}, a space, {@code #} or {@code :}, may not start
 * with {@code -}, {@code _} or {@code +}, and may not be {@code .} or {@code ..}.
 * A class name reaches here already sandbox-prefixed ({@code sandboxId + className}); the
 * business layer keeps the original spelling, the physical index is normalized.</p>
 */
final class EsNaming {

	private EsNaming() {
	}

	/** The physical index for a sandbox-scoped class; blank namespace prefixes nothing. */
	static String indexName(String namespace, String className) {
		String raw = (namespace == null ? "" : namespace) + (className == null ? "" : className);
		return sanitize(raw);
	}

	static String sanitize(String raw) {
		String name = raw == null ? "" : raw.trim();
		name = name.replace('/', '_').toLowerCase(Locale.ROOT);
		name = name.replaceAll("[^a-z0-9_\\-]", "_");
		if (name.isEmpty()) {
			name = "index";
		}
		// A leading -, _ or + is rejected by the engine; dot-only names are reserved.
		char first = name.charAt(0);
		if (first == '-' || first == '_' || first == '+' || first == '.') {
			name = "i" + name;
		}
		return name;
	}
}
