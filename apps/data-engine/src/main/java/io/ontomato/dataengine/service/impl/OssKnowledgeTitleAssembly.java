package io.ontomato.dataengine.service.impl;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.ontomato.dataengine.service.UntitledKnowledgeTitlePrefix;

/** OSS stores this prefix when a knowledge row is created without a title. */
@Configuration
public class OssKnowledgeTitleAssembly {

    @Bean
    public UntitledKnowledgeTitlePrefix untitledKnowledgeTitlePrefix() {
        return new UntitledKnowledgeTitlePrefix("Business knowledge ");
    }
}
