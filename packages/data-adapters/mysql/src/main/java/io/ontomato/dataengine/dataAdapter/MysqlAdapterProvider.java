package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class MysqlAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "mysql";
	}

	@Override
	public String label() {
		return "MySQL";
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
		return Map.of("url", "jdbc:mysql://host:port/db?useSSL=false", "user", "root");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new MysqlAdapter(connection, jsonRule);
	}
}
