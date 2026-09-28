package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import io.ontomato.dataengine.config.DataRagConfig;

/** The app pom's adapter modules are what the registry reports. */
class DataAdapterAssemblyTest {

	@Test
	void theOpenSourceEditionInstallsPostgresqlOnly() {
		try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
			ctx.register(DataRagConfig.class);
			ctx.scan("io.ontomato.dataengine.dataAdapter");
			ctx.refresh();
			List<DataAdapterProvider> installed = ctx.getBean(DataAdapterRegistry.class).installed();
			assertEquals(List.of("postgresql"), installed.stream().map(DataAdapterProvider::type).sorted().toList());
			assertEquals(Map.of("url", "jdbc:postgresql://host:port/db", "user", "postgres"),
					installed.get(0).connectionExamples());
		}
	}
}
