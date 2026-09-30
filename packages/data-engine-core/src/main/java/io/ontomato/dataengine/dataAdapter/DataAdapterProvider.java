package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.config.DataRagConfig;

/**
 * One installed data adapter. Each adapter module contributes exactly one Spring component;
 * the application pom decides which modules, and therefore which types, an edition has.
 */
public interface DataAdapterProvider {

	/** The saved and API value, e.g. "postgresql". */
	String type();

	/** Display name, e.g. "PostgreSQL". */
	String label();

	/** Whether the adapter's query language is SQL. */
	boolean sql();

	/** Connection fields the adapter reads, each one of "url", "user", "password". */
	List<String> connectionFields();

	/** Input hints shown for connection fields, field name to example value; fields without a hint are absent. */
	Map<String, String> connectionExamples();

	/** jsonRule may be null for operations that do not translate DSL. */
	DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule);
}
