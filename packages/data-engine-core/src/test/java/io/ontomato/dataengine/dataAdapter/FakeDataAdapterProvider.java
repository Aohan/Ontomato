package io.ontomato.dataengine.dataAdapter;

import static org.mockito.Mockito.mock;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.config.DataRagConfig;

/** A provider that records what the registry hands it. */
public class FakeDataAdapterProvider implements DataAdapterProvider {

	private final String type;
	private final String label;
	private final List<String> fields;
	private final Map<String, String> examples;
	public DataAdapterConnection lastConnection;
	public DataRagConfig lastDataRagConfig;
	public Map<String, Object> lastJsonRule;

	public FakeDataAdapterProvider(String type, String label, List<String> fields) {
		this(type, label, fields, Map.of());
	}

	public FakeDataAdapterProvider(String type, String label, List<String> fields, Map<String, String> examples) {
		this.type = type;
		this.label = label;
		this.fields = fields;
		this.examples = examples;
	}

	@Override
	public String type() {
		return type;
	}

	@Override
	public String label() {
		return label;
	}

	@Override
	public boolean sql() {
		return !fields.isEmpty();
	}

	@Override
	public List<String> connectionFields() {
		return fields;
	}

	@Override
	public Map<String, String> connectionExamples() {
		return examples;
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		lastConnection = connection;
		lastDataRagConfig = dataRagConfig;
		lastJsonRule = jsonRule;
		return mock(DataAdapter.class);
	}
}
