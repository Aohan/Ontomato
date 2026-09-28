package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

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
			assertEquals(List.of("postgresql"),
					ctx.getBean(DataAdapterRegistry.class).installed().stream().map(DataAdapterProvider::type).sorted().toList());
		}
	}
}
