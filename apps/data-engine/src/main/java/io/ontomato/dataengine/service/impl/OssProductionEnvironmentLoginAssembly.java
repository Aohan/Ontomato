package io.ontomato.dataengine.service.impl;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.ontomato.dataengine.service.ProductionEnvironmentLoginPolicy;

/** OSS skips production login when the configured account is missing or blank. */
@Configuration
public class OssProductionEnvironmentLoginAssembly {

    @Bean
    public ProductionEnvironmentLoginPolicy productionEnvironmentLoginPolicy() {
        return configuredUser -> configuredUser != null && !"".equals(configuredUser.trim());
    }
}
