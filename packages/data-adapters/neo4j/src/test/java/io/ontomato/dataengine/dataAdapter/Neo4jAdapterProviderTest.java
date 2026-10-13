package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.config.DataRagConfig;

/** The Neo4j provider's contract: its type, label, non-SQL flag, and connection fields. */
class Neo4jAdapterProviderTest {

	private final Neo4jAdapterProvider provider = new Neo4jAdapterProvider();

	@Test
	void declaresTypeLabelAndFields() {
		assertEquals("neo4j", provider.type());
		assertEquals("Neo4j", provider.label());
		assertFalse(provider.requiresJoinFields());
		assertEquals(List.of("url", "user", "password"), provider.connectionFields());
		assertEquals(Map.of("url", "bolt://host:7687", "user", "neo4j"), provider.connectionExamples());
	}

	@Test
	void createsAnAdapterForTheGivenConnection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl("bolt://host:7687");
		DataAdapter adapter = provider.create(connection, new DataRagConfig(), Map.of("classDef", List.of()));
		assertEquals(Neo4jAdapter.class, adapter.getClass());
	}
}
