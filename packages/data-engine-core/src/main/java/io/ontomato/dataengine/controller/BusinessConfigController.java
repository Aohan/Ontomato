package io.ontomato.dataengine.controller;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import io.ontomato.dataengine.config.AgentConfig;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.BusinessConfig.Db2DataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.DuckDBDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.DmDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.EmbeddingModelProperties;
import io.ontomato.dataengine.config.BusinessConfig.GaussDBDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.MysqlDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.OracleDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.PgsqlDataAdapterProperties;
import io.ontomato.dataengine.config.BusinessConfig.SqlServerDataAdapterProperties;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.config.CustomRequestParameters;
import io.ontomato.dataengine.dataAdapter.DataAdapterFactory;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class BusinessConfigController {

	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private MultiThreadAIChatService multiThreadAIChatService;
	
	@Autowired
	private EmbeddingService embeddingService;
	
	@PostMapping("/businessConfig/testModel")
    @ResponseBody
    public JSONObject testModel(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
			ModelConfig model = input.getJSONObject("model").toJavaObject(
					ModelConfig.class, JSONReader.Feature.DisableReferenceDetect);
			model.setCustomRequestParameters(CustomRequestParameters.normalize(
					input.getJSONObject("model").get("customRequestParameters")));
    		String userContent = input.getString("prompt");
    		if (userContent == null || "".equals(userContent.trim())) {
    			userContent = "Hello";
    		}
    		String aiContent = multiThreadAIChatService.testModel(model, userContent, user.getDomainId());
    		ret.put("data", aiContent);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@PostMapping("/businessConfig/saveModels")
    @ResponseBody
    public JSONObject saveModels(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		if (input.getJSONArray("models") == null) {
    			throw new IllegalArgumentException("models must not be empty");
    		}
			List<ModelConfig> models = input.getJSONArray("models").toJavaList(
					ModelConfig.class, JSONReader.Feature.DisableReferenceDetect);
			if (models == null) {
				models = new ArrayList<>();
			}
			for (ModelConfig model : models) {
				model.setCustomRequestParameters(CustomRequestParameters.normalize(
						model.getCustomRequestParameters()));
			}
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		businessConfig.setModels(models);
    		ModelResolver.requireConnections(models);
    		ModelResolver.validateForSave(businessConfig);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	/**
	 * Model references of the five roles are saved in one call: the input first goes through boundary checks on object, key set and string types,
	 * then ModelResolver.validateForSave validates the candidate config once; on failure the stored object stays unchanged, on success the candidate is persisted only once.
	 */
	@PostMapping("/businessConfig/saveAgentModels")
    @ResponseBody
    public JSONObject saveAgentModels(@RequestBody JSONObject input) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Object raw = input.get("modelsByRole");
			if (!(raw instanceof Map<?, ?> modelsByRole)) {
				throw new IllegalArgumentException("modelsByRole must be an object");
			}
			if (!modelsByRole.keySet().equals(AgentRole.ALL)) {
				throw new IllegalArgumentException(
						"modelsByRole must contain all five roles and no unknown roles: " + modelsByRole.keySet());
			}
			for (String role : AgentRole.ALL) {
				if (!(modelsByRole.get(role) instanceof String)) {
					throw new IllegalArgumentException("The model reference of role " + role + " must be a string");
				}
			}
			BusinessConfig stored = businessConfigService.get(user.getDomainId());
			// The candidate config replaces only the five changed roles with independent copies, while other fields share the stored object;
			// if validation fails the stored object stays unchanged, and on success the candidate is persisted only once.
			BusinessConfig candidate = new BusinessConfig();
			BeanUtils.copyProperties(stored, candidate);
			Map<String, AgentConfig> agents = new LinkedHashMap<>();
			for (String role : AgentRole.ALL) {
				AgentConfig agent = new AgentConfig();
				BeanUtils.copyProperties(stored.getAgents().get(role), agent);
				agent.setModel((String) modelsByRole.get(role));
				agents.put(role, agent);
			}
			candidate.setAgents(agents);
			ModelResolver.validateForSave(candidate);
			businessConfigService.set(candidate, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/** The skill directory hangs only on the execution field of toolChat; changing it touches no model reference. */
	@PostMapping("/businessConfig/saveToolSkillDir")
    @ResponseBody
    public JSONObject saveToolSkillDir(@RequestBody JSONObject input) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Object raw = input.get("skilldir");
			if (!(raw instanceof String skilldir)) {
				throw new IllegalArgumentException("skilldir must be a string");
			}
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			businessConfig.getAgents().get(AgentRole.TOOL_CHAT).setSkilldir(skilldir);
			businessConfigService.set(businessConfig, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/businessConfig/testEmbeddingModel")
    @ResponseBody
    public JSONObject testEmbeddingModel(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		EmbeddingModelProperties embeddingModelProperties = JSONObject.parseObject(JSON.toJSONString(input.getJSONObject("modelConfig")), EmbeddingModelProperties.class);
    		embeddingModelProperties.setLogRequests(true);
    		embeddingModelProperties.setLogResponses(true);
    		String userContent = input.getString("userContent");
    		if (userContent == null || "".equals(userContent.trim())) {
    			userContent = "Hello";
    		}
    		JSONObject aiContent = embeddingService.testEmbeddingModel(embeddingModelProperties, userContent);
    		ret.put("data", aiContent);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveEmbeddingModel")
    @ResponseBody
    public JSONObject saveEmbeddingModel(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		EmbeddingModelProperties embeddingModelProperties = JSONObject.parseObject(JSON.toJSONString(input), EmbeddingModelProperties.class);
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		EmbeddingModelProperties oldEmbeddingModelProperties = businessConfig.getEmbeddingModelProperties();
			// In getConfig, embeddingModelProperties:null means not configured; in that case create the existing object before writing.
			if (oldEmbeddingModelProperties == null) {
				oldEmbeddingModelProperties = businessConfig.new EmbeddingModelProperties();
				businessConfig.setEmbeddingModelProperties(oldEmbeddingModelProperties);
			}
    		oldEmbeddingModelProperties.setBaseUrl(embeddingModelProperties.getBaseUrl());
    		oldEmbeddingModelProperties.setApiKey(embeddingModelProperties.getApiKey());
    		oldEmbeddingModelProperties.setModelName(embeddingModelProperties.getModelName());
    		oldEmbeddingModelProperties.setTimeout(embeddingModelProperties.getTimeout());
    		oldEmbeddingModelProperties.setCustomHeaders(embeddingModelProperties.getCustomHeaders());
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveKnowledgeMaxResult")
    @ResponseBody
    public JSONObject saveKnowledgeMaxResult(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Integer knowledgeMaxResult = input.getInteger("knowledgeMaxResult");
    		if (knowledgeMaxResult != null) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setKnowledgeMaxResult(knowledgeMaxResult);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveToolAndPythonRetry")
    @ResponseBody
    public JSONObject saveToolAndPythonRetry(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Integer toolAndPythonRetry = input.getInteger("toolAndPythonRetry");
    		if (toolAndPythonRetry != null) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setToolAndPythonRetry(toolAndPythonRetry);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveDslCookerTries")
    @ResponseBody
    public JSONObject saveDslCookerTries(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Integer dslCookerTries = input.getInteger("dslCookerTries");
    		if (dslCookerTries != null && dslCookerTries > 0) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setDslCookerTries(dslCookerTries);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveDslCookerTimeout")
    @ResponseBody
    public JSONObject saveDslCookerTimeout(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Long dslCookerTimeout = input.getLong("dslCookerTimeout");
    		if (dslCookerTimeout != null && dslCookerTimeout > 0) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setDslCookerTimeout(dslCookerTimeout);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveQuestionSpliterTries")
    @ResponseBody
    public JSONObject saveQuestionSpliterTries(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Integer questionSpliterTries = input.getInteger("questionSpliterTries");
    		if (questionSpliterTries != null && questionSpliterTries > 0) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setQuestionSpliterTries(questionSpliterTries);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveQuestionSpliterTimeout")
    @ResponseBody
    public JSONObject saveQuestionSpliterTimeout(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Long questionSpliterTimeout = input.getLong("questionSpliterTimeout");
    		if (questionSpliterTimeout != null && questionSpliterTimeout > 0) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setQuestionSpliterTimeout(questionSpliterTimeout);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveLang")
    @ResponseBody
    public JSONObject saveLang(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String lang = input.getString("lang");
    		if (lang != null) {
    			lang = lang.trim();
    		}
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		businessConfig.setLang(lang);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useM3DataAdapter")
    @ResponseBody
    public JSONObject useM3DataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		businessConfig.setDataAdapter(DataAdapterFactory.M3);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useMysqlDataAdapter")
    @ResponseBody
    public JSONObject useMysqlDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String mysqlUrl = input.getString("mysqlUrl");
    		String mysqlUser = input.getString("mysqlUser");
    		String mysqlPassword = input.getString("mysqlPassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		MysqlDataAdapterProperties mysqlDataAdapterProperties = businessConfig.getMysqlDataAdapterProperties();
    		if (mysqlDataAdapterProperties == null) {
    			mysqlDataAdapterProperties = businessConfig.new MysqlDataAdapterProperties();
    			businessConfig.setMysqlDataAdapterProperties(mysqlDataAdapterProperties);
    		}
    		mysqlDataAdapterProperties.setMysqlUrl(mysqlUrl);
    		mysqlDataAdapterProperties.setMysqlUser(mysqlUser);
    		mysqlDataAdapterProperties.setMysqlPassword(mysqlPassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.MYSQL);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/usePostgreDataAdapter")
    @ResponseBody
    public JSONObject usePostgreDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String pgsqlUrl = input.getString("pgsqlUrl");
    		String pgsqlUser = input.getString("pgsqlUser");
    		String pgsqlPassword = input.getString("pgsqlPassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		PgsqlDataAdapterProperties pgsqlDataAdapterProperties = businessConfig.getPgsqlDataAdapterProperties();
    		if (pgsqlDataAdapterProperties == null) {
    			pgsqlDataAdapterProperties = businessConfig.new PgsqlDataAdapterProperties();
    			businessConfig.setPgsqlDataAdapterProperties(pgsqlDataAdapterProperties);
    		}
    		pgsqlDataAdapterProperties.setPgsqlUrl(pgsqlUrl);
    		pgsqlDataAdapterProperties.setPgsqlUser(pgsqlUser);
    		pgsqlDataAdapterProperties.setPgsqlPassword(pgsqlPassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.POSTGRESQL);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useOracleDataAdapter")
    @ResponseBody
    public JSONObject useOracleDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String oracleUrl = input.getString("oracleUrl");
    		String oracleUser = input.getString("oracleUser");
    		String oraclePassword = input.getString("oraclePassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		OracleDataAdapterProperties oracleDataAdapterProperties = businessConfig.getOracleDataAdapterProperties();
    		if (oracleDataAdapterProperties == null) {
    			oracleDataAdapterProperties = businessConfig.new OracleDataAdapterProperties();
    			businessConfig.setOracleDataAdapterProperties(oracleDataAdapterProperties);
    		}
    		oracleDataAdapterProperties.setOracleUrl(oracleUrl);
    		oracleDataAdapterProperties.setOracleUser(oracleUser);
    		oracleDataAdapterProperties.setOraclePassword(oraclePassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.ORACLE);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useSqlServerDataAdapter")
    @ResponseBody
    public JSONObject useSqlServerDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String sqlServerUrl = input.getString("sqlServerUrl");
    		String sqlServerUser = input.getString("sqlServerUser");
    		String sqlServerPassword = input.getString("sqlServerPassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		SqlServerDataAdapterProperties sqlServerDataAdapterProperties = businessConfig.getSqlServerDataAdapterProperties();
    		if (sqlServerDataAdapterProperties == null) {
    			sqlServerDataAdapterProperties = businessConfig.new SqlServerDataAdapterProperties();
    			businessConfig.setSqlServerDataAdapterProperties(sqlServerDataAdapterProperties);
    		}
    		sqlServerDataAdapterProperties.setSqlServerUrl(sqlServerUrl);
    		sqlServerDataAdapterProperties.setSqlServerUser(sqlServerUser);
    		sqlServerDataAdapterProperties.setSqlServerPassword(sqlServerPassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.SQL_SERVER);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useDb2DataAdapter")
    @ResponseBody
    public JSONObject useDb2DataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String db2Url = input.getString("db2Url");
    		String db2User = input.getString("db2User");
    		String db2Password = input.getString("db2Password");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		Db2DataAdapterProperties db2DataAdapterProperties = businessConfig.getDb2DataAdapterProperties();
    		if (db2DataAdapterProperties == null) {
    			db2DataAdapterProperties = businessConfig.new Db2DataAdapterProperties();
    			businessConfig.setDb2DataAdapterProperties(db2DataAdapterProperties);
    		}
    		db2DataAdapterProperties.setDb2Url(db2Url);
    		db2DataAdapterProperties.setDb2User(db2User);
    		db2DataAdapterProperties.setDb2Password(db2Password);
    		businessConfig.setDataAdapter(DataAdapterFactory.DB2);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useDmDataAdapter")
    @ResponseBody
    public JSONObject useDmDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String dmUrl = input.getString("dmUrl");
    		String dmUser = input.getString("dmUser");
    		String dmPassword = input.getString("dmPassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		DmDataAdapterProperties dmDataAdapterProperties = businessConfig.getDmDataAdapterProperties();
    		if (dmDataAdapterProperties == null) {
    			dmDataAdapterProperties = businessConfig.new DmDataAdapterProperties();
    			businessConfig.setDmDataAdapterProperties(dmDataAdapterProperties);
    		}
    		dmDataAdapterProperties.setDmUrl(dmUrl);
    		dmDataAdapterProperties.setDmUser(dmUser);
    		dmDataAdapterProperties.setDmPassword(dmPassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.DM);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useGaussDBDataAdapter")
    @ResponseBody
    public JSONObject useGaussDBDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String gaussDBUrl = input.getString("gaussDBUrl");
    		String gaussDBUser = input.getString("gaussDBUser");
    		String gaussDBPassword = input.getString("gaussDBPassword");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		GaussDBDataAdapterProperties gaussDBDataAdapterProperties = businessConfig.getGaussDBDataAdapterProperties();
    		if (gaussDBDataAdapterProperties == null) {
    			gaussDBDataAdapterProperties = businessConfig.new GaussDBDataAdapterProperties();
    			businessConfig.setGaussDBDataAdapterProperties(gaussDBDataAdapterProperties);
    		}
    		gaussDBDataAdapterProperties.setGaussDBUrl(gaussDBUrl);
    		gaussDBDataAdapterProperties.setGaussDBUser(gaussDBUser);
    		gaussDBDataAdapterProperties.setGaussDBPassword(gaussDBPassword);
    		businessConfig.setDataAdapter(DataAdapterFactory.GAUSSDB);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/useDuckDBDataAdapter")
    @ResponseBody
    public JSONObject useDuckDBDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String duckdbUrl = input.getString("duckdbUrl");
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		DuckDBDataAdapterProperties duckDBDataAdapterProperties = businessConfig.getDuckDBDataAdapterProperties();
    		if (duckDBDataAdapterProperties == null) {
    			duckDBDataAdapterProperties = businessConfig.new DuckDBDataAdapterProperties();
    			businessConfig.setDuckDBDataAdapterProperties(duckDBDataAdapterProperties);
    		}
    		duckDBDataAdapterProperties.setDuckdbUrl(duckdbUrl);
    		businessConfig.setDataAdapter(DataAdapterFactory.DUCKDB);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@GetMapping("/businessConfig/getConfig")
    @ResponseBody
    public JSONObject getConfig() {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
			ret.put("data", businessConfigService.get(user.getDomainId()));
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@GetMapping("/businessConfig/getConfigAndDesc")
    @ResponseBody
    public JSONObject getConfigAndDesc() {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		JSONObject data = new JSONObject();
    		data.put("config", businessConfigService.getRuntimeWholeConfig(user.getDomainId()));
    		data.put("desc", businessConfigService.getWholeConfigDesc());
    		ret.put("data", data);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
}
