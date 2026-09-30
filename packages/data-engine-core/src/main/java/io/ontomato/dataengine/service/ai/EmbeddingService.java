package io.ontomato.dataengine.service.ai;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.EmbeddingModelProperties;
import io.ontomato.dataengine.service.BusinessConfigService;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.model.output.Response;

@Component("embeddingService")
public class EmbeddingService {

	@Autowired
	private BusinessConfigService businessConfigService;
	
	/** The global embedding dimension comes only from the configuration file langchain4j.open-ai.embedding-model.dimensions. */
	@Autowired
	private EmbeddingModelProperties configuredEmbeddingModelProperties;

	public Response<Embedding> embedding(String content, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		EmbeddingModel embedingModel = buildModel(businessConfig.getEmbeddingModelProperties());
		return embedingModel.embed(content);
	}
	
	public JSONObject testEmbeddingModel(BusinessConfig.EmbeddingModelProperties embeddingModelProperties, String content) throws Exception {
		EmbeddingModel embedingModel = buildModel(embeddingModelProperties);
		Response<Embedding> resp = embedingModel.embed(content);
		Embedding embedding = resp.content();
		int dimension = embedding.dimension();
		Integer configuredDimension = configuredEmbeddingModelProperties.getDimensions();
		if (dimension != configuredDimension) {
			throw new IllegalArgumentException("The vector dimension returned by the embedding model " + dimension
					+ " and the configured embedding dimension " + configuredDimension + " are inconsistent");
		}
		JSONObject ret = new JSONObject();
		ret.put("dimension", dimension);
		ret.put("vector", embedding.vector());
		return ret;
	}
	
	private EmbeddingModel buildModel(BusinessConfig.EmbeddingModelProperties embeddingModelProperties) {
		EmbeddingModel embedingModel = OpenAiEmbeddingModel.builder()
		        .baseUrl(embeddingModelProperties.getBaseUrl())
		        .apiKey(embeddingModelProperties.getApiKey())
		        .modelName(embeddingModelProperties.getModelName())
		        .dimensions(configuredEmbeddingModelProperties.getDimensions())
		        .timeout(embeddingModelProperties.getTimeout())
		        .logRequests(embeddingModelProperties.getLogRequests())
		        .logResponses(embeddingModelProperties.getLogResponses())
		        .customHeaders(embeddingModelProperties.getCustomHeaders())
		        .build();
		return embedingModel;
	}
	
}
