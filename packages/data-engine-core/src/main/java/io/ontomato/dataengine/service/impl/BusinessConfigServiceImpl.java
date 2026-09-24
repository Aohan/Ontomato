package io.ontomato.dataengine.service.impl;

import java.io.File;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.BusinessConfig.MysqlDataAdapterProperties;
import io.ontomato.dataengine.config.DaoConst;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.EmbeddingModelProperties;
import io.ontomato.dataengine.config.ModelDefaultsProperties;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.service.IdentityRuntimeSettings;
import io.ontomato.dataengine.dao.BusinessConfigDao;
import io.ontomato.dataengine.service.BusinessConfigService;

@Service
public class BusinessConfigServiceImpl implements BusinessConfigService {

	@Autowired
    private ModelDefaultsProperties modelDefaultsProperties;

    @Autowired
    private EmbeddingModelProperties embeddingModelProperties;

    @Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private BusinessConfigDao businessConfigDao;

	@Autowired
	private Environment environment;

	@Autowired
	private IdentityRuntimeSettings identityRuntimeSettings;

	@Override
	public void set(BusinessConfig businessConfig, String domainId) {
		businessConfigDao.save(businessConfig, domainId);
	}

	@Override
	public BusinessConfig get(String domainId) {
		BusinessConfig businessConfig = businessConfigDao.query(domainId);
		if (businessConfig == null) {
			businessConfig = BusinessConfig.from(
					modelDefaultsProperties,
					embeddingModelProperties,
					dataRagConfig);
			ModelResolver.validateForSave(businessConfig);
			set(businessConfig, domainId);
		}
		// The sole boundary where this method reads a persisted record or seeds a new record: a missing display name is initialized to name,
		// missing/null apiKeys are returned as an empty array as not configured; role references and real keys are untouched, and old records need no manual migration.
		ModelResolver.normalizeForRead(businessConfig.getModels());
		return businessConfig;
	}

	@Override
	public JSONObject getRuntimeWholeConfig(String domainId) {
		BusinessConfig businessConfig = get(domainId);

		JSONObject wholeConfig = new JSONObject();

		JSONObject server = new JSONObject();
		server.put("port", Integer.parseInt(environment.getProperty("server.port")));
		server.put("max-http-post-size", environment.getProperty("server.max-http-post-size"));
		wholeConfig.put("server", server);

		JSONObject spring = new JSONObject();
		JSONObject springConfig = new JSONObject();
		springConfig.put("import", environment.getProperty("spring.config.import"));
		spring.put("config", springConfig);
		JSONObject springServlet = new JSONObject();
		JSONObject springServletMultipart = new JSONObject();
		springServletMultipart.put("max-file-size", environment.getProperty("spring.servlet.multipart.max-file-size"));
		springServletMultipart.put("max-request-size", environment.getProperty("spring.servlet.multipart.max-request-size"));
		springServlet.put("multipart", springServletMultipart);
		spring.put("servlet", springServlet);
		wholeConfig.put("spring", spring);

		JSONObject langchain4j = new JSONObject();
		JSONObject langchain4jOpen_ai = new JSONObject();
		langchain4jOpen_ai.put("models", businessConfig.getModels());
		langchain4jOpen_ai.put("agents", businessConfig.getAgents());
		langchain4jOpen_ai.put("embedding-model", businessConfig.getEmbeddingModelProperties());
		langchain4j.put("open-ai", langchain4jOpen_ai);
		wholeConfig.put("langchain4j", langchain4j);

		JSONObject ontomato = new JSONObject();
		DataRagConfig drc = JSON.parseObject(JSON.toJSONString(dataRagConfig), DataRagConfig.class);
		drc.setKnowledgeMaxResult(businessConfig.getKnowledgeMaxResult());
		drc.setToolAndPythonRetry(businessConfig.getToolAndPythonRetry());
		drc.setDslCookerTries(businessConfig.getDslCookerTries());
		drc.setDslCookerTimeout(businessConfig.getDslCookerTimeout());
		drc.setQuestionSpliterTries(businessConfig.getQuestionSpliterTries());
		drc.setQuestionSpliterTimeout(businessConfig.getQuestionSpliterTimeout());
		drc.setDataAdapter(businessConfig.getDataAdapter());
		if (businessConfig.getMysqlDataAdapterProperties() != null) {
			MysqlDataAdapterProperties mysqlDataAdapterProperties = businessConfig.getMysqlDataAdapterProperties();
			drc.setMysqlUrl(mysqlDataAdapterProperties.getMysqlUrl());
			drc.setMysqlUser(mysqlDataAdapterProperties.getMysqlUser());
			drc.setMysqlPassword(mysqlDataAdapterProperties.getMysqlPassword());
		}
		ontomato.put("datarag", drc);
		ontomato.put("sso", identityRuntimeSettings.ssoSettings());
		ontomato.put("ldap", identityRuntimeSettings.ldapSettings());
		wholeConfig.put("ontomato", ontomato);

		wholeConfig.put("subQueryCacheDir", new File("conf/" + DaoConst.SUB_QUERY_CACHE_DIR_NAME).getAbsolutePath());

		return wholeConfig;
	}

	@Override
	public String getWholeConfigDesc() {
		return "The initial models and roles of a new domain come from the startup template conf-defaults (the container overwrites the conf copy on every startup), "
				+ "and long-term deployment differences go through the existing env mapping.\n"
				+ "For a saved domain, the models under `langchain4j.open-ai` (a named model list, including connections and all request parameters) "
				+ "and agents (model references and execution fields of the five roles) can take effect promptly after being configured through the page or API, and are retained after restart.\n"
				+ "The configurations `ontomato.datarag.knowledgeMaxResult`, "
				+ "`ontomato.datarag.toolAndPythonRetry`, "
				+ "`ontomato.datarag.dslCookerTries`, "
				+ "`ontomato.datarag.dslCookerTimeout`, "
				+ "`ontomato.datarag.questionSpliterTries`, "
				+ "`ontomato.datarag.questionSpliterTimeout`, "
				+ "`ontomato.datarag.dataAdapter`, "
				+ "`ontomato.datarag.mysqlUrl`, "
				+ "`ontomato.datarag.mysqlUser`, "
				+ "`ontomato.datarag.mysqlPassword` all take effect promptly after being configured through the page.\n"
				+ "Directly editing conf/application.yml on site will be overwritten by the template after restart and is not retained permanently; "
				+ "apart from these configuration items, other configurations can only take effect after changing the template or the deployment configuration and restarting the application.";
	}

}
