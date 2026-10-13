package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class Neo4jAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "neo4j";
	}

	@Override
	public String label() {
		return "Neo4j";
	}

	@Override
	public boolean requiresJoinFields() {
		return false;
	}

	/** The Bolt URI, plus the user and password of a Neo4j credential; the database defaults to "neo4j". */
	@Override
	public List<String> connectionFields() {
		return List.of("url", "user", "password");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return Map.of("url", "bolt://host:7687", "user", "neo4j");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new Neo4jAdapter(connection, jsonRule);
	}
}
