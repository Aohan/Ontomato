package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class Db2AdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "db2";
	}

	@Override
	public String label() {
		return "DB2";
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
		return Map.of("url", "jdbc:db2://host:port/db", "user", "db2inst1");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new Db2Adapter(connection, jsonRule);
	}
}
