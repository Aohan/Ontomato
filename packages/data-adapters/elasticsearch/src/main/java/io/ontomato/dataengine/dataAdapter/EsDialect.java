package io.ontomato.dataengine.dataAdapter;

/**
 * The two engines this module serves. They share the REST search subset this adapter uses;
 * they differ in the point-in-time API and in the accelerators each one offers. The dialect
 * is the single switch that keeps one implementation covering both.
 */
public enum EsDialect {

	ELASTICSEARCH("elasticsearch", "Elasticsearch"),
	OPENSEARCH("opensearch", "OpenSearch");

	private final String type;
	private final String label;

	EsDialect(String type, String label) {
		this.type = type;
		this.label = label;
	}

	public String type() {
		return type;
	}

	public String label() {
		return label;
	}
}
