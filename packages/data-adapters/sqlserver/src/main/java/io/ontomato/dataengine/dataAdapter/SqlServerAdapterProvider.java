package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class SqlServerAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "sqlserver";
	}

	@Override
	public String label() {
		return "SQL Server";
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
		return Map.of("url", "jdbc:sqlserver://host:port;database=db", "user", "sa");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new SqlServerAdapter(connection, jsonRule);
	}
}
