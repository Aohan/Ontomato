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
		private Duration timeout;
		private Boolean logRequests;
	    private Boolean logResponses;
	    private Map<String, String> customHeaders;
	}
	
	public static BusinessConfig from(
			io.ontomato.dataengine.config.ModelDefaultsProperties modelDefaultsProperties,
			io.ontomato.dataengine.config.EmbeddingModelProperties fileEmbeddingModelProperties,
			DataRagConfig dataRagConfig) {
		BusinessConfig businessConfig = new BusinessConfig();
			List<ModelConfig> models = new ArrayList<>();
			if (modelDefaultsProperties.getModels() != null) {
				for (ModelConfig defaultsModel : modelDefaultsProperties.getModels()) {
					ModelConfig model = new ModelConfig();
					BeanUtils.copyProperties(defaultsModel, model);
					model.setApiKeys(defaultsModel.getApiKeys() == null
							? new ArrayList<>()
							: new ArrayList<>(defaultsModel.getApiKeys()));
					model.setCustomRequestParameters(CustomRequestParameters.normalize(
							defaultsModel.getCustomRequestParameters() == null
									? new LinkedHashMap<>()
									: defaultsModel.getCustomRequestParameters()));
					models.add(model);
				}
			}
			businessConfig.setModels(models);

			Map<String, AgentConfig> agents = new LinkedHashMap<>();
			if (modelDefaultsProperties.getAgents() != null) {
				for (Map.Entry<String, AgentConfig> entry : modelDefaultsProperties.getAgents().entrySet()) {
					AgentConfig defaultsAgent = entry.getValue();
					AgentConfig agent = new AgentConfig();
					agent.setModel(defaultsAgent.getModel());
					agent.setActorCopies(defaultsAgent.getActorCopies());
					agent.setSkilldir(defaultsAgent.getSkilldir());
					agents.put(entry.getKey(), agent);
				}
			}
			businessConfig.setAgents(agents);
			
			EmbeddingModelProperties embeddingModelProperties = businessConfig.new EmbeddingModelProperties();
			embeddingModelProperties.setBaseUrl(fileEmbeddingModelProperties.getBaseUrl());
			embeddingModelProperties.setApiKey(fileEmbeddingModelProperties.getApiKey());
			embeddingModelProperties.setModelName(fileEmbeddingModelProperties.getModelName());
			embeddingModelProperties.setTimeout(fileEmbeddingModelProperties.getTimeout());
			embeddingModelProperties.setLogRequests(fileEmbeddingModelProperties.getLogRequests());
			embeddingModelProperties.setLogResponses(fileEmbeddingModelProperties.getLogResponses());
			businessConfig.setEmbeddingModelProperties(embeddingModelProperties);
			
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
