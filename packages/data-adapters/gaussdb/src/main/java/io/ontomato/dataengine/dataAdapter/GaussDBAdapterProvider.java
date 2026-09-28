package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class GaussDBAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "gaussdb";
	}

	@Override
	public String label() {
		return "GaussDB";
	}

	@Override
	public boolean sql() {
		return true;
	}

	@Override
	public List<String> connectionFields() {
		return List.of("url", "user", "password");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return Map.of("url", "jdbc:postgresql://host:port/db", "user", "gaussdb");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new GaussDBAdapter(connection, jsonRule);
	}
}
