package io.ontomato.dataengine.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Map;

@Configuration
@ConfigurationProperties(prefix = "ontomato.data-engine")
public class DataRagConfig {

	private String serviceId;

	private String nodeId;

//    /** Metadata storage location */
//    private String metaNameSpace = "datarag";

    // Minimum similarity score when the vector cache looks up similar questions

    // Maximum number of cached results returned when the vector cache looks up similar questions

    private String cardBaseUrl;

    // Maximum number of business knowledge results returned when the vector business knowledge base looks up similar questions
    private int knowledgeMaxResult;

    private List<Map<String, String>> mcpClients;

    private String pythonpath;

    private String pythonCharset;

    private int toolAndPythonRetry;

    private int toolsDataMaxSize;


    private Integer dslCookerTries = 1;

    private Long dslCookerTimeout = 5 * 60 * 1000L;

    private Integer questionSpliterTries = 1;

    private Long questionSpliterTimeout = 3 * 60 * 1000L;

    private String dataAdapter;
    
    private String productionEnvUrl;
    
    private String productionEnvUser;
    
    private String productionEnvPwd;
    
    public String getProductionEnvUrl() {
		return productionEnvUrl;
	}

	public void setProductionEnvUrl(String productionEnvUrl) {
		this.productionEnvUrl = productionEnvUrl;
	}

	public String getProductionEnvUser() {
		return productionEnvUser;
	}

	public void setProductionEnvUser(String productionEnvUser) {
		this.productionEnvUser = productionEnvUser;
	}

	public String getProductionEnvPwd() {
		return productionEnvPwd;
	}

	public void setProductionEnvPwd(String productionEnvPwd) {
		this.productionEnvPwd = productionEnvPwd;
	}

	public String getDataAdapter() {
		return dataAdapter;
	}

	public void setDataAdapter(String dataAdapter) {
		this.dataAdapter = dataAdapter;
	}

	public Long getQuestionSpliterTimeout() {
		return questionSpliterTimeout;
	}

	public void setQuestionSpliterTimeout(Long questionSpliterTimeout) {
		this.questionSpliterTimeout = questionSpliterTimeout;
	}

	public Integer getQuestionSpliterTries() {
		return questionSpliterTries;
	}

	public void setQuestionSpliterTries(Integer questionSpliterTries) {
		this.questionSpliterTries = questionSpliterTries;
	}

	public Long getDslCookerTimeout() {
		return dslCookerTimeout;
	}

	public void setDslCookerTimeout(Long dslCookerTimeout) {
		this.dslCookerTimeout = dslCookerTimeout;
	}

	public Integer getDslCookerTries() {
		return dslCookerTries;
	}

	public void setDslCookerTries(Integer dslCookerTries) {
		this.dslCookerTries = dslCookerTries;
	}



	private String[] dslMightTimeFormats;

    public String[] getDslMightTimeFormats() {
		return dslMightTimeFormats;
	}

	public void setDslMightTimeFormats(String[] dslMightTimeFormats) {
		this.dslMightTimeFormats = dslMightTimeFormats;
	}

	public int getToolAndPythonRetry() {
        return toolAndPythonRetry;
    }

    public void setToolAndPythonRetry(int toolAndPythonRetry) {
        this.toolAndPythonRetry = toolAndPythonRetry;
    }
    public String getPythonCharset() {
        return pythonCharset;
    }

    public void setPythonCharset(String pythonCharset) {
        this.pythonCharset = pythonCharset;
    }

    public String getPythonpath() {
        return pythonpath;
    }

    public void setPythonpath(String pythonpath) {
        this.pythonpath = pythonpath;
    }


    public List<Map<String, String>> getMcpClients() {
        return mcpClients;
    }

    public void setMcpClients(List<Map<String, String>> mcpClients) {
        this.mcpClients = mcpClients;
    }

    public String getCardBaseUrl() {
        return cardBaseUrl;
    }

    public void setCardBaseUrl(String cardBaseUrl) {
        this.cardBaseUrl = cardBaseUrl;
    }

    public int getKnowledgeMaxResult() {
        return knowledgeMaxResult;
    }

    public void setKnowledgeMaxResult(int knowledgeMaxResult) {
        this.knowledgeMaxResult = knowledgeMaxResult;
    }

    public int getToolsDataMaxSize() {
        return toolsDataMaxSize;
    }

    public void setToolsDataMaxSize(int toolsDataMaxSize) {
        this.toolsDataMaxSize = toolsDataMaxSize;
    }

    public String getServiceId() {
		return serviceId;
	}

	public void setServiceId(String serviceId) {
		this.serviceId = serviceId;
	}

	public String getNodeId() {
		return nodeId;
	}

	public void setNodeId(String nodeId) {
		this.nodeId = nodeId;
	}

}
