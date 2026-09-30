package io.ontomato.dataengine.config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import lombok.Data;

/**
 * Source of initialization defaults when creating a domain (ontomato.data-engine.models / ontomato.data-engine.agents in application.yml).
 * Seeded once by BusinessConfigServiceImpl only when there is no record in business_config.
 */
@Configuration
@Data
@ConfigurationProperties(prefix = "ontomato.data-engine")
public class ModelDefaultsProperties {

    private List<ModelConfig> models = new ArrayList<>();
    private Map<String, AgentConfig> agents = new LinkedHashMap<>();
}
