package io.ontomato.dataengine.config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;

import org.springframework.beans.BeanUtils;

import lombok.Data;

@Data
public class BusinessConfig {

	private List<ModelConfig> models = new ArrayList<>();

	private Map<String, AgentConfig> agents = new LinkedHashMap<>();
	
	private EmbeddingModelProperties EmbeddingModelProperties;

	/** The embedding connection, model name and dimensions the vectors of this domain were generated with. */
	private EmbeddingVectorSource embeddingVectorSource;
	
	private int knowledgeMaxResult;
	
	private int toolAndPythonRetry;
	
	private Integer dslCookerTries;
    private Long dslCookerTimeout;
    
    private Integer questionSpliterTries;
    private Long questionSpliterTimeout;
    
    private Integer reportCardPythonTimeout = 60;
    
    private String lang;
    
    private String dataAdapter;
    /** Saved connection per data adapter type. */
    private Map<String, DataAdapterConnection> dataAdapterConnections = new LinkedHashMap<>();

	@Data
	public class EmbeddingModelProperties {
		private String baseUrl;
		private String apiKey;
		private String modelName;
		private Integer dimensions;
		private Duration timeout;
		private Boolean logRequests;
	    private Boolean logResponses;
	    private Map<String, String> customHeaders;
	}

	@Data
	public static class EmbeddingVectorSource {
		private String baseUrl;
		private String modelName;
		private Integer dimensions;
	}
	
	public static BusinessConfig from(
			io.ontomato.dataengine.config.ModelDefaultsProperties modelDefaultsProperties,
			io.ontomato.dataengine.config.EmbeddingModelProperties fileEmbeddingModelProperties,
			DataRagConfig dataRagConfig) {
		BusinessConfig businessConfig = new BusinessConfig();
		List<ModelConfig> models = new ArrayList<>();
		ModelConfig defaultSeed = null;
		for (ModelConfig m : modelDefaultsProperties.getModels()) {
			if ("default".equals(m.getName())) {
				defaultSeed = m;
				break;
			}
		}

		boolean hasCompleteConnection = ModelResolver.hasCompleteConnection(defaultSeed);

		AgentConfig templateCoding = modelDefaultsProperties.getAgents().get(AgentRole.CODING);
		String codingSkillDir = templateCoding != null ? templateCoding.getSkilldir() : null;

		Map<String, AgentConfig> agents = new LinkedHashMap<>();
		if (hasCompleteConnection) {
			ModelConfig model = new ModelConfig();
			BeanUtils.copyProperties(defaultSeed, model);
			model.setName("default");
			if (model.getDisplayName() == null || model.getDisplayName().isBlank()) {
				model.setDisplayName("default");
			}
			List<String> validKeys = new ArrayList<>();
			for (String key : defaultSeed.getApiKeys()) {
				if (key != null && !key.isBlank()) {
					validKeys.add(key.trim());
				}
			}
			model.setApiKeys(validKeys);
			model.setCustomRequestParameters(CustomRequestParameters.normalize(
					defaultSeed.getCustomRequestParameters() == null
							? new LinkedHashMap<>()
							: defaultSeed.getCustomRequestParameters()));
			models.add(model);

			for (String role : AgentRole.ALL) {
				AgentConfig agent = new AgentConfig();
				agent.setModel("default");
				if (AgentRole.CODING.equals(role)) {
					agent.setSkilldir(codingSkillDir);
				}
				agents.put(role, agent);
			}
		} else {
			for (String role : AgentRole.ALL) {
				AgentConfig agent = new AgentConfig();
				agent.setModel(null);
				if (AgentRole.CODING.equals(role)) {
					agent.setSkilldir(codingSkillDir);
				}
				agents.put(role, agent);
			}
		}

		businessConfig.setModels(models);
		businessConfig.setAgents(agents);
			
			EmbeddingModelProperties embeddingModelProperties = businessConfig.new EmbeddingModelProperties();
			embeddingModelProperties.setBaseUrl(fileEmbeddingModelProperties.getBaseUrl());
			embeddingModelProperties.setApiKey(fileEmbeddingModelProperties.getApiKey());
			embeddingModelProperties.setModelName(fileEmbeddingModelProperties.getModelName());
			embeddingModelProperties.setDimensions(fileEmbeddingModelProperties.getDimensions());
			embeddingModelProperties.setTimeout(fileEmbeddingModelProperties.getTimeout());
			embeddingModelProperties.setLogRequests(fileEmbeddingModelProperties.getLogRequests());
			embeddingModelProperties.setLogResponses(fileEmbeddingModelProperties.getLogResponses());
			businessConfig.setEmbeddingModelProperties(embeddingModelProperties);
			// A new domain has no vectors yet, so the configuration its vectors were generated with equals its initial configuration.
			EmbeddingVectorSource embeddingVectorSource = new EmbeddingVectorSource();
			embeddingVectorSource.setBaseUrl(fileEmbeddingModelProperties.getBaseUrl());
			embeddingVectorSource.setModelName(fileEmbeddingModelProperties.getModelName());
			embeddingVectorSource.setDimensions(fileEmbeddingModelProperties.getDimensions());
			businessConfig.setEmbeddingVectorSource(embeddingVectorSource);
			
			businessConfig.setKnowledgeMaxResult(dataRagConfig.getKnowledgeMaxResult());
			
			businessConfig.setToolAndPythonRetry(dataRagConfig.getToolAndPythonRetry());
			
			businessConfig.setDslCookerTries(dataRagConfig.getDslCookerTries());
			businessConfig.setDslCookerTimeout(dataRagConfig.getDslCookerTimeout());
		    
			businessConfig.setQuestionSpliterTries(dataRagConfig.getQuestionSpliterTries());
			businessConfig.setQuestionSpliterTimeout(dataRagConfig.getQuestionSpliterTimeout());
		    
			businessConfig.setDataAdapter(dataRagConfig.getDataAdapter());
		return businessConfig;
    }
}
