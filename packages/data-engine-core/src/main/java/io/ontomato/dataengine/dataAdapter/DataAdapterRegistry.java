package io.ontomato.dataengine.dataAdapter;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;

/** The data adapters installed in this edition, keyed by type. */
@Component
public class DataAdapterRegistry {

	private final Map<String, DataAdapterProvider> providers = new HashMap<>();
	private final DataRagConfig dataRagConfig;

	public DataAdapterRegistry(List<DataAdapterProvider> providers, DataRagConfig dataRagConfig) {
		for (DataAdapterProvider provider : providers) {
			if (this.providers.putIfAbsent(provider.type(), provider) != null) {
				throw new IllegalStateException("Duplicate data adapter type: " + provider.type());
			}
		}
		this.dataRagConfig = dataRagConfig;
	}

	public DataAdapterProvider provider(String type) {
		DataAdapterProvider provider = providers.get(type);
		if (provider == null) {
			throw new IllegalArgumentException("本版本未安装该数据适配器: " + type);
		}
		return provider;
	}

	/** The adapter of the business config's current type, with that type's saved connection. */
	public DataAdapter create(BusinessConfig businessConfig, Map<String, Object> jsonRule) {
		String type = businessConfig.getDataAdapter();
		return provider(type).create(businessConfig.getDataAdapterConnections().get(type), dataRagConfig, jsonRule);
	}

	public List<DataAdapterProvider> installed() {
		return providers.values().stream().sorted(Comparator.comparing(DataAdapterProvider::label)).toList();
	}
}
