package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;

class DataAdapterRegistryTest {

	private static final List<String> SQL_FIELDS = List.of("url", "user", "password");

	@Test
	void aDuplicateTypeFailsStartup() {
		IllegalStateException failure = assertThrows(IllegalStateException.class, () -> new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", SQL_FIELDS),
				new FakeDataAdapterProvider("postgresql", "Other", SQL_FIELDS)), new DataRagConfig()));
		assertTrue(failure.getMessage().contains("postgresql"), failure.getMessage());
	}

	@Test
	void installedIsSortedByLabel() {
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", SQL_FIELDS),
				new FakeDataAdapterProvider("m3", "M3", List.of()),
				new FakeDataAdapterProvider("duckdb", "DuckDB", List.of("url"))), new DataRagConfig());

		assertEquals(List.of("duckdb", "m3", "postgresql"),
				registry.installed().stream().map(DataAdapterProvider::type).toList());
	}

	@Test
	void createHandsTheCurrentTypeItsSavedConnection() {
		FakeDataAdapterProvider postgresql = new FakeDataAdapterProvider("postgresql", "PostgreSQL", SQL_FIELDS);
		FakeDataAdapterProvider mysql = new FakeDataAdapterProvider("mysql", "MySQL", SQL_FIELDS);
		DataRagConfig dataRagConfig = new DataRagConfig();
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(postgresql, mysql), dataRagConfig);
		BusinessConfig businessConfig = new BusinessConfig();
		DataAdapterConnection pg = new DataAdapterConnection();
		pg.setUrl("jdbc:postgresql://pg");
		businessConfig.getDataAdapterConnections().put("postgresql", pg);
		businessConfig.getDataAdapterConnections().put("mysql", new DataAdapterConnection());
		businessConfig.setDataAdapter("postgresql");
		Map<String, Object> jsonRule = Map.of("classDef", List.of());

		registry.create(businessConfig, jsonRule);

		assertSame(pg, postgresql.lastConnection);
		assertSame(dataRagConfig, postgresql.lastDataRagConfig);
		assertSame(jsonRule, postgresql.lastJsonRule);
	}

	@Test
	void aTypeWithoutSavedConnectionGetsAnEmptyOne() {
		FakeDataAdapterProvider mysql = new FakeDataAdapterProvider("mysql", "MySQL", SQL_FIELDS);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(mysql), new DataRagConfig());
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("mysql");

		registry.create(businessConfig, null);

		assertEquals(new DataAdapterConnection(), mysql.lastConnection);
	}

	@Test
	void aTypeThatIsNotInstalledIsReportedWithoutFallback() {
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", SQL_FIELDS)), new DataRagConfig());
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("m3");

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> registry.create(businessConfig, null));
		assertTrue(failure.getMessage().contains("m3"), failure.getMessage());
		assertTrue(failure.getMessage().contains("Data adapter not installed in this edition"), failure.getMessage());
	}
}
