package io.ontomato.dataengine.service.ai;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import io.ontomato.dataengine.tools.ABCProgramDashboardMakerSkillTools;
import io.ontomato.dataengine.tools.ABCProgrammerSkillTools;
import io.ontomato.dataengine.tools.ActionCodeExplainerSkillTools;
import io.ontomato.dataengine.tools.AfterCalculatorResultSubmitTools;
import io.ontomato.dataengine.tools.AfterCalculatorSkillTools;
import io.ontomato.dataengine.tools.AfterCalculatorSubmitTools;
import io.ontomato.dataengine.tools.DataDetectorSkillTools;
import io.ontomato.dataengine.tools.DslSkillTools;
import io.ontomato.dataengine.tools.DslSubmitTools;
import io.ontomato.dataengine.tools.MetricViewSubmitTools;
import io.ontomato.dataengine.tools.ReadFunctionMakerSkillTools;
import io.ontomato.dataengine.tools.ReadFunctionSubmitTools;
import io.ontomato.dataengine.tools.SandboxSkillTools;
import io.ontomato.dataengine.tools.SchemaSkillTools;
import io.ontomato.dataengine.tools.SkillTools;
import io.ontomato.dataengine.tools.ActionSubmitTools;
import io.ontomato.dataengine.tools.DashboardSubmitTools;
import io.ontomato.dataengine.tools.WriteFunctionMakerSkillTools;

import dev.langchain4j.skills.FileSystemSkillLoader;
import dev.langchain4j.skills.Skills;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonParseException;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.config.ModelResolver.ResolvedChatModel;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.tools.ABCHarnessFileTools;
import io.ontomato.dataengine.logging.AgentLlmCallListener;
import io.ontomato.dataengine.util.LogHelper;

import dev.langchain4j.service.tool.ToolProvider;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.Result;
import dev.langchain4j.service.tool.ToolErrorContext;
import dev.langchain4j.service.tool.ToolErrorHandlerResult;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("multiThreadAIChatService")
public class MultiThreadAIChatService {
	
	public static final String QUESTION_SPLITER_V0 = "QUESTION_SPLITER_V0";
	public static final String QUESTION_SPLITER_V1 = "QUESTION_SPLITER_V1";
	public static final String QUESTION_SPLITER_EVALUATOR = "QUESTION_SPLITER_EVALUATOR";
	
	public static final String DSL_COOKER = "DSL_COOKER";
	public static final String DSL_COOKER_EVALUATOR = "DSL_COOKER_EVALUATOR";
	public static final String DSL_DESCRIBER = "DSL_DESCRIBER";
	
	public static final String PYTHON_CALCULATOR = "PYTHON_CALCULATOR";
	public static final String PYTHON_CALCULATOR_EVALUATOR = "PYTHON_CALCULATOR_EVALUATOR";
	public static final String TOOL_AND_PYTHON_CALCULATOR = "TOOL_AND_PYTHON_CALCULATOR";
	public static final String TOOL_CALCULATOR_EVALUATOR = "TOOL_CALCULATOR_EVALUATOR";
	public static final String AFTER_CALCULATE_DESCRIBER = "AFTER_CALCULATE_DESCRIBER";
	
	public static final String QUESTION_CHECKER = "QUESTION_CHECKER";
	public static final String QUESTION_CHECKER_V2 = "QUESTION_CHECKER_V2";
	
	public static final String DASHBOARD_RENAMER = "DASHBOARD_RENAMER";
	
	public static final String BUSSINESS_KNOWLEDGE_GENERATOR = "BUSSINESS_KNOWLEDGE_GENERATOR";
	
	public static final String JSON_CORRECTOR = "JSON_CORRECTOR";
	
	public static final String ABC_PROGRAMMER = "ABC_PROGRAMMER";
	
	public static final String ABC_PROGRAM_DESCRIBER = "ABC_PROGRAM_DESCRIBER";
	
	public static final String ABC_PROGRAM_DASHBOARD_MAKER = "ABC_PROGRAM_DASHBOARD_MAKER";
	
	public static final String READ_FUNCTION_MAKER = "READ_FUNCTION_MAKER";
	
	public static final String STATIC_READ_FUNCTION_NAME_MAKER = "STATIC_READ_FUNCTION_NAME_MAKER";
	
	public static final String READ_FUNCTION_INSTANCER = "READ_FUNCTION_INSTANCER";
	
	public static final String METRIC_VIEW_MAKER = "METRIC_VIEW_MAKER";
	
	public static final String ACTION_MAKER = "ACTION_MAKER";
	
	public static final String ACTION_CODE_EXPLAINER = "ACTION_CODE_EXPLAINER";
	
	private static final AgentLlmCallListener LLM_CALL_LISTENER = new AgentLlmCallListener();

	static <T> AiServices<T> withToolErrorFeedback(AiServices<T> aiServices) {
		return aiServices
				.toolArgumentsErrorHandler(MultiThreadAIChatService::toolArgumentsErrorResult)
				.toolExecutionErrorHandler(MultiThreadAIChatService::toolExecutionErrorResult)
				.hallucinatedToolNameStrategy(MultiThreadAIChatService::missingToolResult);
	}

	private static ToolErrorHandlerResult toolArgumentsErrorResult(Throwable error, ToolErrorContext context) {
		JsonParseException syntaxError = findJsonSyntaxError(error);
		if (syntaxError == null) {
			return ToolErrorHandlerResult.text("Invalid tool arguments, the tool was not executed:\n" + rawErrorText(error));
		}
		String feedback = "Tool argument JSON syntax error, the tool was not executed; the argument contract has not been validated yet:\n" + rawErrorText(error);
		String failureContext = toolArgumentFailureContext(syntaxError, context);
		if (!failureContext.isEmpty()) {
			feedback += "\n" + failureContext;
		}
		return ToolErrorHandlerResult.text(feedback);
	}

	private static ToolErrorHandlerResult toolExecutionErrorResult(Throwable error, ToolErrorContext context) {
		return ToolErrorHandlerResult.text("Tool execution failed:\n" + rawErrorText(error));
	}

	private static final int FORMAL_DEFAULT_MAX_COMPLETION_TOKENS = 50000;

	/**
	 * The single entry point for building chat models: the model configuration drives the SDK, with strictTools determined by the caller branch.
	 * Custom JSON is not preprocessed by the SDK and is overwritten as a whole at the final HTTP exit (see OntomatoHttpClientBuilder).
	 */
	static ChatModel buildChatModel(ModelConfig model, boolean strictTools, Integer defaultMaxCompletionTokens) {
		return OpenAiChatModel.builder()
				.httpClientBuilder(new OntomatoHttpClientBuilder(model.getCustomRequestParameters()))
				.baseUrl(model.getBaseUrl())
				.apiKey(model.getApiKeys().get(0))
				.organizationId(model.getOrganizationId())
				.projectId(model.getProjectId())
				.modelName(model.getModelName())
				.temperature(model.getTemperature())
				.topP(model.getTopP())
				.stop(model.getStop())
				.maxTokens(model.getMaxTokens())
				.maxCompletionTokens(model.getMaxCompletionTokens() != null ? model.getMaxCompletionTokens() : defaultMaxCompletionTokens)
				.presencePenalty(model.getPresencePenalty())
				.frequencyPenalty(model.getFrequencyPenalty())
				.logitBias(model.getLogitBias())
				.responseFormat(model.getResponseFormat())
				.supportedCapabilities(model.getSupportedCapabilities())
				.strictJsonSchema(model.getStrictJsonSchema())
				.seed(model.getSeed())
				.user(model.getUser())
				.strictTools(strictTools)
				.parallelToolCalls(model.getParallelToolCalls())
				.store(model.getStore())
				.metadata(model.getMetadata())
				.serviceTier(model.getServiceTier())
				.reasoningEffort(model.getReasoningEffort())
				.timeout(model.getTimeout())
				.maxRetries(model.getMaxRetries())
				.logRequests(model.getLogRequests())
				.logResponses(model.getLogResponses())
				.listeners(List.of(LLM_CALL_LISTENER))
				.returnThinking(true)
				.sendThinking(true)
				.customHeaders(model.getCustomHeaders())
				.build();
	}

	private static JsonParseException findJsonSyntaxError(Throwable error) {
		for (Throwable current = error; current != null; current = current.getCause()) {
			if (current instanceof JsonParseException jsonParseException) {
				return jsonParseException;
			}
		}
		return null;
	}

	private static String toolArgumentFailureContext(JsonParseException error, ToolErrorContext context) {
		if (context == null || context.toolExecutionRequest() == null || error.getLocation() == null) {
			return "";
		}
		String arguments = context.toolExecutionRequest().arguments();
		long charOffset = error.getLocation().getCharOffset();
		if (arguments == null || arguments.isEmpty() || charOffset < 0) {
			return "";
		}
		int position = (int) Math.min(charOffset, arguments.length());
		int start = Math.max(0, position - TOOL_ARGUMENT_ERROR_CONTEXT_RADIUS);
		int end = Math.min(arguments.length(), position + TOOL_ARGUMENT_ERROR_CONTEXT_RADIUS + 1);
		String prefix = start > 0 ? "…" : "";
		String suffix = end < arguments.length() ? "…" : "";
		String excerpt = arguments.substring(start, end).replace('\r', ' ').replace('\n', ' ');
		return "Tool arguments near the failure position (^ marks the parse failure position):\n"
				+ prefix + excerpt + suffix + "\n"
				+ " ".repeat(prefix.length() + position - start) + "^";
	}

	private static ToolExecutionResultMessage missingToolResult(ToolExecutionRequest request) {
		return ToolExecutionResultMessage.builder()
				.id(request.id())
				.toolName(request.name())
				.text("Tool " + request.name() + " does not exist, not executed")
				.isError(true)
				.build();
	}

	// Only the message of each level of the exception chain is concatenated; stack frames do not enter the Agent feedback; over-limit text is truncated keeping the head and tail, with the total length noted (blueprint defensive clause)
	private static final int RAW_ERROR_MAX_CHARS = 4000;
	private static final int RAW_ERROR_HEAD_CHARS = 3000;
	private static final int RAW_ERROR_TAIL_CHARS = 1000;
	private static final int TOOL_ARGUMENT_ERROR_CONTEXT_RADIUS = 120;

	public static String rawErrorText(Throwable error) {
		StringBuilder text = new StringBuilder();
		for (Throwable current = error; current != null; current = current.getCause()) {
			String message = current.getMessage();
			if (message == null || message.isBlank()) {
				message = current.getClass().getSimpleName();
			}
			if (text.indexOf(message) < 0) {
				if (text.length() > 0) {
					text.append("\nCaused by: ");
				}
				text.append(message);
			}
		}
		if (text.length() <= RAW_ERROR_MAX_CHARS) {
			return text.toString();
		}
		return text.substring(0, RAW_ERROR_HEAD_CHARS)
				+ "\n... (the raw error is " + text.length() + " characters in total, omitting "
				+ (text.length() - RAW_ERROR_HEAD_CHARS - RAW_ERROR_TAIL_CHARS) + " characters here) ...\n"
				+ text.substring(text.length() - RAW_ERROR_TAIL_CHARS);
	}
    
    @Autowired
    private ChatMemoryProvider chatMemoryProvider;
    
    @Autowired
    private ToolProvider toolProvider;
    
    @Autowired
    private SchemaSkillTools schemaSkillTools;
    
    @Autowired
    private DslSkillTools dslSkillTools;

	@Autowired
	private DslSubmitTools dslSubmitTools;

	@Autowired
	private ABCHarnessFileTools abcHarnessFileTools;
    
    @Autowired
    private DataDetectorSkillTools dataDetectorSkillTools;
    
    @Autowired
    private AfterCalculatorSkillTools afterCalculatorSkillTools;

	@Autowired
	private AfterCalculatorSubmitTools afterCalculatorSubmitTools;

	@Autowired
	private AfterCalculatorResultSubmitTools afterCalculatorResultSubmitTools;
    
    @Autowired
    private ABCProgrammerSkillTools abcProgrammerSkillTools;
    
    @Autowired
    private ABCProgramDashboardMakerSkillTools abcProgramDashboardMakerSkillTools;
    
    @Autowired
    private ReadFunctionMakerSkillTools readFunctionMakerSkillTools;

	@Autowired
	private ReadFunctionSubmitTools readFunctionSubmitTools;

	@Autowired
	private MetricViewSubmitTools metricViewSubmitTools;
    
    @Autowired
    private SandboxSkillTools sandboxSkillTools;
    
    @Autowired
    private WriteFunctionMakerSkillTools writeFunctionMakerSkillTools;
    
    @Autowired
    private ActionCodeExplainerSkillTools actionCodeExplainerSkillTools;

	@Autowired
	private ActionSubmitTools actionSubmitTools;

	@Autowired
	private DashboardSubmitTools dashboardSubmitTools;

	private AiServices<NormalAgent> newNormalAgent(ChatModel chatModel) {
		return withToolErrorFeedback(AiServices.builder(NormalAgent.class)
				.chatModel(chatModel)
				.chatMemoryProvider(chatMemoryProvider));
	}
    
    public String testModel(ModelConfig modelConfig, String userContent, String domainId) throws Exception {
		ChatModel chatModel = buildChatModel(modelConfig, false, null);
		NormalAgent chatAgent = newNormalAgent(chatModel).build();
		String sessionId = UUID.randomUUID().toString();
		AgentCallContext.begin(sessionId, "AdhocChat", domainId);
		try {
			Result<String> result = chatAgent.chat(sessionId, userContent);
			return result.content();
		} finally {
			AgentCallContext.end();
		}
    }
    
    public String chat(String agentName, OriginalQuestion originalQuestion, String sessionId, String questionString, ResolvedChatModel modelProperties, String domainId) {
    	try {
    		NormalAgent chatAgent = null;
    		if (TOOL_AND_PYTHON_CALCULATOR.equals(agentName)) {
    			ResolvedChatModel toolModel = modelProperties;
			ChatModel chatModel = buildChatModel(toolModel.model(),
					true, FORMAL_DEFAULT_MAX_COMPLETION_TOKENS);
				String skill_dir = toolModel.getSkilldir();
				Skills skills = null;
				if (skill_dir != null && !skill_dir.isBlank()) {
					try{
						skills = Skills.from(FileSystemSkillLoader.loadSkills(Path.of(skill_dir)));
					} catch (Exception exp){
						log.warn("Failed to load skills from {}",skill_dir);
					}
				}
				if(skills == null){
					chatAgent = newNormalAgent(chatModel)
							.toolProviders(toolProvider)
							.tools(afterCalculatorSkillTools, abcHarnessFileTools,
									afterCalculatorSubmitTools, afterCalculatorResultSubmitTools)
							.build();
				} else {
					SkillTools skilltTools = new SkillTools(skill_dir);
					chatAgent = newNormalAgent(chatModel)
							.tools(skilltTools, abcHarnessFileTools, afterCalculatorSkillTools,
									afterCalculatorSubmitTools, afterCalculatorResultSubmitTools)
							.toolProviders(toolProvider,skills.toolProvider())
							.systemMessage("You have access to the following skills:\n" + skills.formatAvailableSkills()
									+ "\nWhen the user's request relates to one of these skills, activate it first using the `activate_skill` tool before proceeding.")
							.build();
				}
        	} else if (PYTHON_CALCULATOR.equals(agentName)) {
        		ResolvedChatModel pythonModel = modelProperties;
		ChatModel chatModel = buildChatModel(pythonModel.model(),
					false, FORMAL_DEFAULT_MAX_COMPLETION_TOKENS);
				chatAgent = newNormalAgent(chatModel)
		                .tools(afterCalculatorSkillTools, abcHarnessFileTools, afterCalculatorSubmitTools)
		                .build();
        	} else if (ABC_PROGRAMMER.equals(agentName) || 
        			ABC_PROGRAM_DASHBOARD_MAKER.equals(agentName) || 
        			READ_FUNCTION_MAKER.equals(agentName) ||
        			STATIC_READ_FUNCTION_NAME_MAKER.equals(agentName) ||
        			READ_FUNCTION_INSTANCER.equals(agentName) || 
        			METRIC_VIEW_MAKER.equals(agentName) || 
        			ACTION_MAKER.equals(agentName) ||
        			ACTION_CODE_EXPLAINER.equals(agentName)) {
        		ResolvedChatModel cleverModel = modelProperties;
		ChatModel chatModel = buildChatModel(cleverModel.model(),
					false, FORMAL_DEFAULT_MAX_COMPLETION_TOKENS);
				AiServices<NormalAgent> aiServices = newNormalAgent(chatModel);
				if (ABC_PROGRAMMER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools,
							dataDetectorSkillTools,
							abcHarnessFileTools,
							dslSkillTools,
							abcProgrammerSkillTools
					);
				} else if (ABC_PROGRAM_DASHBOARD_MAKER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools,
							abcHarnessFileTools,
							abcProgramDashboardMakerSkillTools,
							dashboardSubmitTools
					);
				} else if (READ_FUNCTION_MAKER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools,
							abcHarnessFileTools,
							readFunctionMakerSkillTools,
							readFunctionSubmitTools
					);
				} else if (READ_FUNCTION_INSTANCER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools
					);
				} else if (METRIC_VIEW_MAKER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools,
							dataDetectorSkillTools,
							abcHarnessFileTools,
							dslSkillTools,
							readFunctionMakerSkillTools,
							metricViewSubmitTools
					);
				} else if (ACTION_MAKER.equals(agentName)) {
					aiServices = aiServices.tools(
							schemaSkillTools,
							dataDetectorSkillTools,
							abcHarnessFileTools,
							dslSkillTools,
							sandboxSkillTools,
							writeFunctionMakerSkillTools,
							actionSubmitTools
					);
				} else if (ACTION_CODE_EXPLAINER.equals(agentName)) {
					aiServices = aiServices.tools(schemaSkillTools,
							actionCodeExplainerSkillTools
					);
				}
				chatAgent = aiServices.build();
        	} else if (QUESTION_SPLITER_V0.equals(agentName) ||
        			QUESTION_SPLITER_V1.equals(agentName)) {
        		ResolvedChatModel splitterModel = modelProperties;
		ChatModel chatModel = buildChatModel(splitterModel.model(),
					false, FORMAL_DEFAULT_MAX_COMPLETION_TOKENS);
				AiServices<NormalAgent> aiServices = newNormalAgent(chatModel);
				if (QUESTION_SPLITER_V1.equals(agentName)) {
					aiServices = aiServices.tools(schemaSkillTools);
				}
				chatAgent = aiServices.build();
        	} else {
        		ResolvedChatModel normalModel = modelProperties;
		ChatModel chatModel = buildChatModel(normalModel.model(),
					false, FORMAL_DEFAULT_MAX_COMPLETION_TOKENS);
				AiServices<NormalAgent> aiServices = newNormalAgent(chatModel);
				if (DSL_COOKER.equals(agentName)) {
					aiServices = aiServices.tools(dslSkillTools, dataDetectorSkillTools, abcHarnessFileTools, dslSubmitTools);
				} else if (ABC_PROGRAM_DESCRIBER.equals(agentName)) {
					aiServices = aiServices.tools(schemaSkillTools);
				}
				chatAgent = aiServices.build();
        	}
    		
			AgentCallContext.begin(sessionId, agentName, domainId);
    		try {
				Result<String> result = chatAgent.chat(sessionId, questionString);
		        String queryJson = result.content();
		        log.info("sessionId:{}, LLM returned query Json>>>:\n{}", sessionId, queryJson);
		        LogHelper.info("LLM returned query Json>>>:\n{}", queryJson);
				return queryJson;
			} finally {
				AgentCallContext.end();
			}
		} catch (RuntimeException e) {
			// Cancellation is not an ordinary failure: it is not logged as an error, it is rethrown as-is, and it does not trigger the caller's retry or fallback.
			SessionCancelledException.throwIfCancelled(e);
			log.error("sessionId:" + sessionId + " failed to call the LLM. " + e.getMessage(), e);
			throw e;
    	}
    }
    
}
