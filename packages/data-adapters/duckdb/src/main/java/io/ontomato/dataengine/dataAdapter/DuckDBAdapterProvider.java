package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class DuckDBAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "duckdb";
	}

	@Override
	public String label() {
		return "DuckDB";
	}

	@Override
	public boolean sql() {
		return true;
	}

	@Override
	public List<String> connectionFields() {
		return List.of("url");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return Map.of("url", "jdbc:duckdb:/data/example.duckdb");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new DuckDBAdapter(connection, jsonRule);
	}
}
