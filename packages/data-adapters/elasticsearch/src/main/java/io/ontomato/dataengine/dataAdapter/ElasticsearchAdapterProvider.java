package io.ontomato.dataengine.dataAdapter;

import org.springframework.stereotype.Component;

@Component
public class ElasticsearchAdapterProvider extends EsAdapterProvider {

	@Override
	protected EsDialect dialect() {
		return EsDialect.ELASTICSEARCH;
	}
}
