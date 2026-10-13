package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.config.DataRagConfig;

/**
 * The shared provider for both engines; a thin subclass pins the dialect.
 *
 * <p>The engines are separate {@code type()} values because the engine is part of a saved
 * connection's identity: it decides which point-in-time API and which accelerators apply.</p>
 */
public abstract class EsAdapterProvider implements DataAdapterProvider {

	protected abstract EsDialect dialect();

	@Override
	public String type() {
		return dialect().type();
	}

	@Override
	public String label() {
		return dialect().label();
	}

	@Override
	public boolean requiresJoinFields() {
		return true;
	}

	@Override
	public List<String> connectionFields() {
		return List.of("url", "user", "password");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return dialect() == EsDialect.OPENSEARCH
				? Map.of("url", "https://host:9200", "user", "admin")
				: Map.of("url", "http://host:9200", "user", "elastic");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new EsAdapter(connection, jsonRule, dialect());
	}
}
