package io.ontomato.dataengine.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import lombok.Data;

@Configuration
@Data
@ConfigurationProperties(prefix = "langchain4j.open-ai.embedding-model")
public class EmbeddingModelProperties {

	private String baseUrl;
	private String apiKey;
	private String modelName;
	private Integer dimensions;
	private Duration timeout;
	private Boolean logRequests;
    private Boolean logResponses;
	
}
