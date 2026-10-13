package io.ontomato.dataengine.dataAdapter;

import org.springframework.stereotype.Component;

@Component
public class OpensearchAdapterProvider extends EsAdapterProvider {

	@Override
	protected EsDialect dialect() {
		return EsDialect.OPENSEARCH;
	}
}
