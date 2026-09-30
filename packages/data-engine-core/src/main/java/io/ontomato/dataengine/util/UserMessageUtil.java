package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.bean.QuestionSpliterEvaluation;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;

import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
public class UserMessageUtil {
	
	public static final String LANG = "{{LANG}}";

	public static final String  QUESTION_SPLITER_V0_PROMPT ="question_spliter_prompt-v0.md";
	public static final String  QUESTION_SPLITER_V1_PROMPT ="question_spliter_prompt-v1.md";

    public static final String  DSL_COOKER_PROMPT ="dsl_cooker_prompt-v1.md";
	public static final String  AFTER_CALCULATOR_PROMPT	= "after_calculator_prompt.md";
	public static final String  PYTHON_CALCULATOR_PROMPT = "python_calculator_prompt.md";
	public static final String  TOOLS_CALCULATOR_PROMPT = "tools_calculator_prompt.md";

	public static final String  SUBQUESTION_JSON_DATA = "{{SUBQUESTION_JSON_DATA}}";
	public static final String  JSON_DATA_SCHEMA = "{{JSON_DATA_SCHEMA}}";
	public static final String  USER_CALCULATOR_REQUIREMENT = "{{USER_CALCULATOR_REQUIREMENT}}";
    public static final String  DATASET_DESC ="{{DATASET_DESC}}";
    public static final String  CLASS_DEF ="{{CLASS_DEF}}";
    public static final String  RELATIONSHIP_DEF ="{{RELATIONSHIP_DEF}}";
    
    public static final String RELATIONSHIP_CHAIN = "{{RELATIONSHIP_CHAIN}}";
    public static final String  BUSSINESS_KNOWLEDGE ="{{BUSSINESS_KNOWLEDGE}}";

	public static final String  USER_CHAT_LOGS = "{{USER_CHAT_LOGS}}";
    public static final String  DSL_RULE = "{{DSL_RULE}}";
    public static final String  DSL_EXAMPLE = "{{DSL_EXAMPLE}}";
    public static final String  USER_QUESTION ="{{USER_QUESTION}}";
    public static final String QUESTION_SPLITER_EXAMPLE = "{{QUESTION_SPLITER_EXAMPLE}}";
    public static final String ABC_PROGRAMMER_EXAMPLE = "{{ABC_PROGRAMMER_EXAMPLE}}";
    
	public static final String KNOWLEDGE_SUMMARY_PROMPT ="knowledge_summary_prompt.md";
    
    public static final String DSL_DESCRIBER_PROMPT ="dsl_describer.md";
    public static final String DSL_STR = "{{DSL_STR}}";
    
    public static final String AFTER_CALCULATE_DESCRIBER_PROMPT ="after_calculate_describer.md";
    public static final String AFTER_CALCULATE_PARAM_DESC = "{{AFTER_CALCULATE_PARAM_DESC}}";
    public static final String AFTER_CALCULATE_LOGIC = "{{AFTER_CALCULATE_LOGIC}}";
    
    public static final String QUESTION_CHECKER_PROMPT ="question_checker.md";
    public static final String QUESTION_CHECKER_LOGIC_DESC = "{{QUESTION_CHECKER_LOGIC_DESC}}";
    
    public static final String QUESTION_SPLITER_EVALUATOR_PROMPT = "question_spliter_evaluator_prompt.md";
    public static final String QUESTION_SPLITER_EVALUATOR_INPUT = "{{QUESTION_SPLITER_EVALUATOR_INPUT}}";
    public static final String QUESTION_SPLITER_EVALUATOR_OUTPUT = "{{QUESTION_SPLITER_EVALUATOR_OUTPUT}}";
    
    public static final String DSL_COOKER_EVALUATOR_PROMPT = "dsl_cooker_evaluator_prompt.md";
    public static final String DSL_COOKER_EVALUATOR_INPUT = "{{DSL_COOKER_EVALUATOR_INPUT}}";
    public static final String DSL_COOKER_EVALUATOR_OUTPUT = "{{DSL_COOKER_EVALUATOR_OUTPUT}}";
    
    public static final String PYTHON_CALCULATOR_EVALUATOR_PROMPT = "python_calculator_evaluator_prompt.md";
    public static final String PYTHON_CALCULATOR_EVALUATOR_INPUT = "{{PYTHON_CALCULATOR_EVALUATOR_INPUT}}";
    public static final String PYTHON_CALCULATOR_EVALUATOR_OUTPUT = "{{PYTHON_CALCULATOR_EVALUATOR_OUTPUT}}";
    
    public static final String TOOLS_CALCULATOR_EVALUATOR_PROMPT = "tools_calculator_evaluator_prompt.md";
    public static final String TOOLS_CALCULATOR_EVALUATOR_INPUT = "{{TOOLS_CALCULATOR_EVALUATOR_INPUT}}";
    public static final String TOOLS_CALCULATOR_EVALUATOR_OUTPUT = "{{TOOLS_CALCULATOR_EVALUATOR_OUTPUT}}";
    
    public static final String JSON_CORRECTOR_PROMPT = "json_corrector.md";
    public static final String JSON_CORRECTOR_WRONG_JSON = "{{WRONG_JSON}}";
    
    public static final String DASHBOARD_RENAMER_PROMPT = "dashboard_renamer.md";
    public static final String DASHBOARD_RENAMER_INPUT = "{{DASHBOARD}}";
    
    public static final String REPORT_CARD_PROGRAMMER_SERVER_PORT = "{{SERVER_PORT}}";
    
    public static final String ABC_PROGRAMMER_PROMPT = "abc_programmer.md";
    
    public static final String ABC_PROGRAM_DESCRIBER_PROMPT = "abc_program_describer.md";
    public static final String PYTHON_CODE = "{{PYTHON_CODE}}";
    
    public static final String QUESTION_CHECKER_V2_PROMPT = "question_checker-v2.md";
    public static final String PROGRAM_DESCRIPTIONS = "{{PROGRAM_DESCRIPTIONS}}";
    
    public static final String ABC_PROGRAM_DASHBOARD_MAKER_PROMPT = "abc_program_dashboard_maker.md";
    
    public static final String READ_FUNCTION_MAKER_PROMPT = "read_function_maker.md";
    
    public static final String STATIC_READ_FUNCTION_NAME_MAKER_PROMPT = "static_read_function_name_maker.md";
    public static final String GENERAL_FUNCTION_NAME = "{{GENERAL_FUNCTION_NAME}}";
    public static final String PARAMETERS = "{{PARAMETERS}}";
    
    public static final String READ_FUNCTION_INSTANCER_PROMPT = "read_function_instancer.md";
    public static final String METRICVIEWS = "{{METRICVIEWS}}";
    
    public static final String METRIC_VIEW_MAKER_PROMPT = "metric_view_maker.md";
    
    public static final String ACTION_MAKER_PROMPT = "action_maker.md";
    
    public static final String ACTION_CODE_EXPLAINER_PROMPT = "action_code_explainer.md";
    
    public static final String TOOLS_LIST = "{{TOOLS_LIST}}";
    
	public static String[] getSplitQuestionV0UserMessage(String sessionid, KnowledgeDao knowledgeDao,
			   BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, String question,
			   int maxKnowledgeResult, String lang, LangService langService, List<String> classNames, Map<String, Object> jsonRule,
			   String example, String domainId) {

		String questionSpliterPrompt = FileUtil.getResourceFileLoadAll(QUESTION_SPLITER_V0_PROMPT, "utf-8");
		String questionSpliterPromptWithoutExample = questionSpliterPrompt + "";
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, classNames, true);
		//dataset description
		String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
		questionSpliterPrompt = questionSpliterPrompt.replace(DATASET_DESC, datasetDesc);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(DATASET_DESC, datasetDesc);
		
		//class definition description
		String classDef = mapDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
		questionSpliterPrompt = questionSpliterPrompt.replace(CLASS_DEF, classDef);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(CLASS_DEF, classDef);
		
		//relationship definition description
		String relationshipDef = mapDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_DEF);
		questionSpliterPrompt = questionSpliterPrompt.replace(RELATIONSHIP_DEF, relationshipDef);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(RELATIONSHIP_DEF, relationshipDef);
		
		//relationship chain definition description
		String relationshipChain = mapDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_CHAIN);
		questionSpliterPrompt = questionSpliterPrompt.replace(RELATIONSHIP_CHAIN, relationshipChain);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(RELATIONSHIP_CHAIN, relationshipChain);
		
		//business knowledge
		String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, businessExampleQuestionSpliterDao,question, maxKnowledgeResult, true, false, domainId);
		questionSpliterPrompt = questionSpliterPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
		
		//user question
		questionSpliterPrompt = questionSpliterPrompt.replace(USER_QUESTION, question);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(USER_QUESTION, question);
		
		//question analyst sample question
		questionSpliterPrompt = questionSpliterPrompt.replace(QUESTION_SPLITER_EXAMPLE, example);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(QUESTION_SPLITER_EXAMPLE, "");
		
		//language
		String langValue = langService.get(lang, "lang");
		questionSpliterPrompt = questionSpliterPrompt.replace(LANG, langValue);
		questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(LANG, langValue);
		
		log.info(">>>\n");
		log.info("sessionid:{}, SplitQuestionUserMessage:\n{}",sessionid,questionSpliterPrompt);
		
		return new String[] {
			questionSpliterPrompt, //complete content
			questionSpliterPromptWithoutExample, //complete content without example question
		};
	}
    
	public static String[] getSplitQuestionV1UserMessage(String sessionid, KnowledgeDao knowledgeDao,
												   BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, String question,
												   int maxKnowledgeResult, String lang, LangService langService, List<String> classNames, Map<String, Object> jsonRule,
												   String example, String domainId) {

        String questionSpliterPrompt = FileUtil.getResourceFileLoadAll(QUESTION_SPLITER_V1_PROMPT, "utf-8");
        String questionSpliterPromptWithoutExample = questionSpliterPrompt + "";

//        Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule);
        //dataset description
//        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        questionSpliterPrompt = questionSpliterPrompt.replace(DATASET_DESC, (String)jsonRule.get("datasetdesc"));
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(DATASET_DESC, (String)jsonRule.get("datasetdesc"));

        //class definition description
//        String classDef = mapDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
        questionSpliterPrompt = questionSpliterPrompt.replace(CLASS_DEF, classDef);
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(CLASS_DEF, classDef);

        //business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, businessExampleQuestionSpliterDao,question, maxKnowledgeResult, true, false, domainId);
        questionSpliterPrompt = questionSpliterPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

        //user question
        questionSpliterPrompt = questionSpliterPrompt.replace(USER_QUESTION, question);
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(USER_QUESTION, question);
        
		//question analyst sample question
		questionSpliterPrompt = questionSpliterPrompt.replace(QUESTION_SPLITER_EXAMPLE, example);
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(QUESTION_SPLITER_EXAMPLE, "");
        
        //language
        String langValue = langService.get(lang, "lang");
        questionSpliterPrompt = questionSpliterPrompt.replace(LANG, langValue);
        questionSpliterPromptWithoutExample = questionSpliterPromptWithoutExample.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, SplitQuestionUserMessage:\n{}",sessionid,questionSpliterPrompt);

        return new String[] {
        		questionSpliterPrompt, //complete content
        		questionSpliterPromptWithoutExample, //complete content without example question
        };
    }

	public static String[] getQuestionUserMessage(String sessionid, KnowledgeDao knowledgeDao,
											  BussinessExampleDao bussinessExampleDao,String question,
											  List<String> classes, JSONObject subQuery, DataAdapter adapter, BusinessConfigService businessConfigService,
											  Map<String, Object> jsonRule, String example, String domainId) {
        String questionPrompt = FileUtil.getResourceFileLoadAll(DSL_COOKER_PROMPT, "utf-8");
        String questionPromptWithoutExample = questionPrompt + "";

        Map<String, String> mapClassDBSchema =DBSchemaUtil.getClassDefWord(jsonRule, classes, adapter);

        //dataset description
        String datasetDesc = mapClassDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        questionPrompt = questionPrompt.replace(DATASET_DESC, datasetDesc);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(DATASET_DESC, datasetDesc);

        //class definition description and sample data
        String classDef = mapClassDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
        questionPrompt = questionPrompt.replace(CLASS_DEF, classDef);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(CLASS_DEF, classDef);

        //relationship definition description
        String relationshipDef = mapClassDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_DEF);
        questionPrompt = questionPrompt.replace(RELATIONSHIP_DEF, relationshipDef);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(RELATIONSHIP_DEF, relationshipDef);

        //relationship chain definition description
//        String relationshipChain = mapClassDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_CHAIN);
        questionPrompt = questionPrompt.replace(RELATIONSHIP_CHAIN, "");
        questionPromptWithoutExample = questionPromptWithoutExample.replace(RELATIONSHIP_CHAIN, "");

        //business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, bussinessExampleDao, null,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), false, true, domainId);
        questionPrompt = questionPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

        //DSL rules
        String dslRule = DslRuleUtil.generateDslRule(subQuery, jsonRule);
        questionPrompt = questionPrompt.replace(DSL_RULE, dslRule);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(DSL_RULE, dslRule);

        //user question
        questionPrompt = questionPrompt.replace(USER_QUESTION, question);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(USER_QUESTION, question);

		//DSL example
		questionPrompt = questionPrompt.replace(DSL_EXAMPLE, example);
        questionPromptWithoutExample = questionPromptWithoutExample.replace(DSL_EXAMPLE, "");

        log.info(">>>\n");
		log.info("sessionid:{}, DSLCookerUserMessage:\n{}",sessionid,questionPrompt);
        return new String[] {questionPrompt, questionPromptWithoutExample};
    }
    
    
    public static String getDslDescriberUserMessage(String sessionid, String dslStr, List<String> classes, DataAdapter adapter, Map<String, Object> jsonRule, String lang, LangService langService) {
        String questionPrompt = FileUtil.getResourceFileLoadAll(DSL_DESCRIBER_PROMPT, "utf-8");
        
        Map<String, String> mapClassDBSchema =DBSchemaUtil.getClassDefWord(jsonRule, classes, adapter);

        //dataset description
        String datasetDesc = mapClassDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        questionPrompt = questionPrompt.replace(DATASET_DESC, datasetDesc);

        //class definition description and sample data
        String classDef = mapClassDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
        questionPrompt = questionPrompt.replace(CLASS_DEF, classDef);

        //relationship definition description
        String relationshipDef = mapClassDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_DEF);
        questionPrompt = questionPrompt.replace(RELATIONSHIP_DEF, relationshipDef);

        //relationship chain definition description
//        String relationshipChain = mapClassDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_CHAIN);
        questionPrompt = questionPrompt.replace(RELATIONSHIP_CHAIN, "");

        //DSL rules
        JSONObject subQuery = new JSONObject();
        subQuery.put("classes", classes);
        subQuery.put("DSL_relationship", true);
        subQuery.put("DSL_C_Step_group_by", true);
        subQuery.put("DSL_C_Step_function", true);
        subQuery.put("DSL_C_Step_four_basic_math", true);
        subQuery.put("DSL_C_Step_sort", true);
        subQuery.put("C_Step", "C_Step");
        String dslRule = DslRuleUtil.generateDslRule(subQuery, jsonRule);
        questionPrompt = questionPrompt.replace(DSL_RULE, dslRule);
        
        //DSL
        questionPrompt = questionPrompt.replace(DSL_STR, dslStr);
        
        //language
        String langValue = langService.get(lang, "lang");
        questionPrompt = questionPrompt.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, DslDescriberUserMessage:\n{}",sessionid,questionPrompt);
        return questionPrompt;
    }
    
    public static String getAfterCalculateDescriberUserMessage(String sessionid, String logic, List<String> cacheFilePaths, List<String> dslMeanings, String lang, LangService langService) {
        String questionPrompt = FileUtil.getResourceFileLoadAll(AFTER_CALCULATE_DESCRIBER_PROMPT, "utf-8");

        //post-calculation parameter explanation
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cacheFilePaths.size(); i++) {
        	String cacheFilePath = cacheFilePaths.get(i);
        	String dslMeaning = dslMeanings.get(i);
        	sb.append("The data of parameter " + (i + 1) + " is obtained by the following query logic:\n");
        	sb.append("```\n");
        	sb.append(dslMeaning + "\n");
        	sb.append("```\n");
        	sb.append("The data file path of parameter " + (i + 1) + " is: " + cacheFilePath + "\n\n");
        }
        questionPrompt = questionPrompt.replace(AFTER_CALCULATE_PARAM_DESC, sb.toString());
        
        //post-calculation program logic
        questionPrompt = questionPrompt.replace(AFTER_CALCULATE_LOGIC, logic);
        
        //language
        String langValue = langService.get(lang, "lang");
        questionPrompt = questionPrompt.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, AfterCalculateDescriberUserMessage:\n{}",sessionid,questionPrompt);
        return questionPrompt;
    }
    
    public static String getQuestionCheckerUserMessage(String sessionid, String question, List<String> dslMeanings, String afterCalculateMeaning,
													   KnowledgeDao knowledgeDao,
													   BussinessExampleDao bussinessExampleDao, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, 
													   BusinessConfigService businessConfigService,
													   String lang, LangService langService, String domainId) {
        String questionPrompt = FileUtil.getResourceFileLoadAll(QUESTION_CHECKER_PROMPT, "utf-8");

        //overall query logic
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < dslMeanings.size(); i++) {
        	String dslMeaning = dslMeanings.get(i);
        	sb.append("- Sub-query logic " + (i + 1) + ":\n");
        	sb.append("```\n");
        	sb.append(dslMeaning + "\n");
        	sb.append("```\n\n");
        }
        if (afterCalculateMeaning != null) {
        	sb.append("- Calculation logic based on the above sub-query results:\n");
        	sb.append("```\n");
        	sb.append(afterCalculateMeaning + "\n");
        	sb.append("```\n\n");
        }
        questionPrompt = questionPrompt.replace(QUESTION_CHECKER_LOGIC_DESC, sb.toString());
        
        //business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), true, true, domainId);
        questionPrompt = questionPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        //user question
        questionPrompt = questionPrompt.replace(USER_QUESTION, question);
        
        //language
        String langValue = langService.get(lang, "lang");
        questionPrompt = questionPrompt.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, QuestionCheckerUserMessage:\n{}",sessionid,questionPrompt);
        return questionPrompt;
    }


	/**Get the automatically generated prompt for Python calculation code
	 * @param knowledgeDao
	 * @param calculatorQuestion
	 * @param maxKnowledgeResult
	 * @return
	 */
	public static String getPythonCalculatorUserMessage(String sessionid, String calculatorQuestion,List<Map> jsonDataSchema,
														KnowledgeDao knowledgeDao,
														BussinessExampleDao bussinessExampleDao, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, int maxKnowledgeResult,
														String lang, LangService langService, String domainId) {

		String pythonCalculatorPrompt = FileUtil.getResourceFileLoadAll(PYTHON_CALCULATOR_PROMPT, "utf-8");
		
		//business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao,
				bussinessExampleDao, businessExampleQuestionSpliterDao, calculatorQuestion, maxKnowledgeResult, true, true, domainId);
        pythonCalculatorPrompt = pythonCalculatorPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

		//sub-query JSON data format
		//PYTHON_JSON_DATA_SCHEMA = "{{JSON_DATA_SCHEMA}}";
		List<Map> userMessageJsonSchema = new ArrayList<Map>();
		for (int i = 0; i < jsonDataSchema.size(); i++) {
			Map mapSubQuestion = new HashMap();
			mapSubQuestion.put("subQuestion", jsonDataSchema.get(i).get("subQuestion"));
			mapSubQuestion.put("datajsonfile", jsonDataSchema.get(i).get("datajsonfile"));
			mapSubQuestion.put("jsonschema", jsonDataSchema.get(i).get("jsonschema"));
			mapSubQuestion.put("sampledatas", jsonDataSchema.get(i).get("samples"));
			userMessageJsonSchema.add(mapSubQuestion);
		}
		String userMessageJsonSchemaStr =JSON.toJSONString(userMessageJsonSchema, Feature.PrettyFormat, Feature.WriteMapNullValue);
		pythonCalculatorPrompt = pythonCalculatorPrompt.replace(JSON_DATA_SCHEMA, userMessageJsonSchemaStr);

		//calculation requirement
		pythonCalculatorPrompt = pythonCalculatorPrompt.replace(USER_CALCULATOR_REQUIREMENT, calculatorQuestion);
		
		//language
        String langValue = langService.get(lang, "lang");
        pythonCalculatorPrompt = pythonCalculatorPrompt.replace(LANG, langValue);

		log.info(">>>\n");
		log.info("sessionid:{}, PythonCalculatorUserMessage:\n{}",sessionid,pythonCalculatorPrompt);

		return pythonCalculatorPrompt;
	}

	public static String getToolsCalculatorUserMessage(String sessionid, String calculatorQuestion,List<Map> jsonData, List<Map> jsonDataSchema,
													   KnowledgeDao knowledgeDao,
													   BussinessExampleDao bussinessExampleDao, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, int maxKnowledgeResult, 
													   String lang, LangService langService, String domainId){
		String toolsCalculatorPrompt = FileUtil.getResourceFileLoadAll(TOOLS_CALCULATOR_PROMPT, "utf-8");
		
		//business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao,
				bussinessExampleDao, businessExampleQuestionSpliterDao, calculatorQuestion, maxKnowledgeResult, true, true, domainId);
        toolsCalculatorPrompt = toolsCalculatorPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

		String jsonDataStr =JSON.toJSONString(jsonData, Feature.PrettyFormat, Feature.WriteMapNullValue);
		toolsCalculatorPrompt = toolsCalculatorPrompt.replace(SUBQUESTION_JSON_DATA, jsonDataStr);

		List<Map> userMessageJsonSchema = new ArrayList<Map>();
		for (int i = 0; i < jsonDataSchema.size(); i++) {
			Map mapSubQuestion = new HashMap();
			mapSubQuestion.put("subQuestion", jsonDataSchema.get(i).get("subQuestion"));
			mapSubQuestion.put("jsonschema", jsonDataSchema.get(i).get("jsonschema"));
			userMessageJsonSchema.add(mapSubQuestion);
		}
		String userMessageJsonSchemaStr =JSON.toJSONString(userMessageJsonSchema, Feature.PrettyFormat, Feature.WriteMapNullValue);
		toolsCalculatorPrompt = toolsCalculatorPrompt.replace(JSON_DATA_SCHEMA, userMessageJsonSchemaStr);

		//calculation requirement
		toolsCalculatorPrompt = toolsCalculatorPrompt.replace(USER_CALCULATOR_REQUIREMENT, calculatorQuestion);
		
		//language
        String langValue = langService.get(lang, "lang");
        toolsCalculatorPrompt = toolsCalculatorPrompt.replace(LANG, langValue);

		log.info(">>>\n");
		log.info("sessionid:{}, ToolsCalculatorUserMessage:\n{}",sessionid,toolsCalculatorPrompt);
		return toolsCalculatorPrompt;
	}

	public static String getKnowledgeUserMessage(List<Map<String,String>> userChatLogs, List<KnowledgeEntity> listKnowledge, Map<String, Object> jsonRule,
			String lang, LangService langService){
		String knowledgeSummryPrompt = FileUtil.getResourceFileLoadAll(KNOWLEDGE_SUMMARY_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
		//dataset description
		String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(DATASET_DESC, datasetDesc);

		//class definition description
		String classDef = mapDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(CLASS_DEF, classDef);

		//relationship definition description
		String relationshipDef = mapDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_DEF);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(RELATIONSHIP_DEF, relationshipDef);

		//relationship chain definition description
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(RELATIONSHIP_CHAIN, "");

		//# existing business knowledge
		StringBuffer sbBussinessKnowledge = new StringBuffer("");
		if(listKnowledge != null && listKnowledge.size() >=0){
			for (KnowledgeEntity knowledgeEntity:listKnowledge) {
				sbBussinessKnowledge.append(" - ").append(knowledgeEntity.getKnowledgeText()).append("\n");
			}
		}
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(BUSSINESS_KNOWLEDGE, sbBussinessKnowledge.toString());

		//# user chat logs
		String jsonStringUserChatLogs = JSONArray.toJSONString(userChatLogs, Feature.PrettyFormat);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(USER_CHAT_LOGS, jsonStringUserChatLogs);
		
		//language
        String langValue = langService.get(lang, "lang");
        knowledgeSummryPrompt = knowledgeSummryPrompt.replace(LANG, langValue);

		log.info(">>>\n");
		log.info("sessionid:{}, KnowledgeUserMessage:\n{}","",knowledgeSummryPrompt);
		return knowledgeSummryPrompt;
	}
	
	public static String getQuestionSpliterEvaluatorUserMessage(QuestionSpliterEvaluation evaluation) {

        String questionPrompt = FileUtil.getResourceFileLoadAll(QUESTION_SPLITER_EVALUATOR_PROMPT, "utf-8");

        // `data query question analyst`'s User Message
        questionPrompt = questionPrompt.replace(QUESTION_SPLITER_EVALUATOR_INPUT, evaluation.getUserMessage());
        
        // `data query question analyst`'s answer
        questionPrompt = questionPrompt.replace(QUESTION_SPLITER_EVALUATOR_OUTPUT, JSON.toJSONString(evaluation.getAnswerObj(), Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat));

        log.info(">>>\n");
        log.info("\n" + questionPrompt);

        return questionPrompt;
    }
	
	public static String getDslCookerEvaluatorUserMessage(DslCookerEvaluation evaluation) {
		String questionPrompt = FileUtil.getResourceFileLoadAll(DSL_COOKER_EVALUATOR_PROMPT, "utf-8");

        // `DSL generator`'s User Message
        questionPrompt = questionPrompt.replace(DSL_COOKER_EVALUATOR_INPUT, evaluation.getUserMessage());
        
        // `DSL generator`'s answer
        String dslStr = evaluation.getDslStr() + "";
        try {
        	dslStr = DslUtil.removeFieldHavingExprForEvaluator(dslStr);
			JSONArray dsls = JSON.parseArray(dslStr);
			if (!dsls.isEmpty()) {
				dslStr = JSON.toJSONString(dsls.getJSONObject(0), Feature.WriteMapNullValue);
			}
        } catch (Exception e) {}
        questionPrompt = questionPrompt.replace(DSL_COOKER_EVALUATOR_OUTPUT, dslStr);

        log.info(">>>\n");
        log.info("\n" + questionPrompt);

        return questionPrompt;
	}
	
	public static String getPythonCalculatorEvaluatorUserMessage(AfterCalculatorEvaluation evaluation) {
		String questionPrompt = FileUtil.getResourceFileLoadAll(PYTHON_CALCULATOR_EVALUATOR_PROMPT, "utf-8");

        // `data analysis Python code writing expert`'s User Message
        questionPrompt = questionPrompt.replace(PYTHON_CALCULATOR_EVALUATOR_INPUT, evaluation.getUserMessage());
        
        // `data analysis Python code writing expert`'s answer
        questionPrompt = questionPrompt.replace(PYTHON_CALCULATOR_EVALUATOR_OUTPUT, evaluation.getCode());

        log.info(">>>\n");
        log.info("\n" + questionPrompt);

        return questionPrompt;
	}
	
	public static String getToolsCalculatorEvaluatorUserMessage(AfterCalculatorEvaluation evaluation) {
		String questionPrompt = FileUtil.getResourceFileLoadAll(TOOLS_CALCULATOR_EVALUATOR_PROMPT, "utf-8");

        // `data analysis expert`'s User Message
        questionPrompt = questionPrompt.replace(TOOLS_CALCULATOR_EVALUATOR_INPUT, evaluation.getUserMessage());
        
        // `data analysis expert`'s answer
        questionPrompt = questionPrompt.replace(TOOLS_CALCULATOR_EVALUATOR_OUTPUT, evaluation.getLogic());

        log.info(">>>\n");
        log.info("\n" + questionPrompt);

        return questionPrompt;
	}

	public static String getAfterCalculatorUserMessage(String sessionid, String calculatorQuestion,List<Map> jsonDataSchema,List<Map> jsonData,
													   KnowledgeDao knowledgeDao,
													   BussinessExampleDao bussinessExampleDao, BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao, int maxKnowledgeResult, 
													   String lang, LangService langService, String domainId) {
		String afterCalculatorPrompt = FileUtil.getResourceFileLoadAll(AFTER_CALCULATOR_PROMPT, "utf-8");

		//business knowledge
		String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao,
				calculatorQuestion, maxKnowledgeResult, true, true, domainId);
		afterCalculatorPrompt = afterCalculatorPrompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

		//sub-query JSON data format
		List<Map> userMessageJsonSchema = new ArrayList<Map>();
		for (int i = 0; i < jsonDataSchema.size(); i++) {
			Map mapSubQuestion = new HashMap();
			mapSubQuestion.put("datajsonfileUrl", jsonDataSchema.get(i).get("datajsonfileUrl"));
			mapSubQuestion.put("subQuestion", jsonDataSchema.get(i).get("subQuestion"));
			mapSubQuestion.put("datajsonfile", jsonDataSchema.get(i).get("datajsonfile"));
			mapSubQuestion.put("jsonschema", jsonDataSchema.get(i).get("jsonschema"));
			mapSubQuestion.put("sampledatas", jsonDataSchema.get(i).get("samples"));
			userMessageJsonSchema.add(mapSubQuestion);
		}
		String userMessageJsonSchemaStr =JSON.toJSONString(userMessageJsonSchema, Feature.PrettyFormat, Feature.WriteMapNullValue);
		afterCalculatorPrompt = afterCalculatorPrompt.replace(JSON_DATA_SCHEMA, userMessageJsonSchemaStr);

		//sub-query JSON data
		if (jsonData == null || jsonData.size() == 0) {
			String dataProccessPrompt = "**The query result data volume is large, please read the datajsonfile file path specified in the above 'Data Format Description of Each Sub-query Result' for analysis.**\n";
			afterCalculatorPrompt = afterCalculatorPrompt.replace(SUBQUESTION_JSON_DATA, dataProccessPrompt);
		} else {
			StringBuffer sbSubQuestionJsonData = new StringBuffer("# Sub-query result data\n");
			sbSubQuestionJsonData.append("```json\n");
			String jsonDataStr =JSON.toJSONString(jsonData, Feature.PrettyFormat, Feature.WriteMapNullValue);
			sbSubQuestionJsonData.append(jsonDataStr).append("\n");
			sbSubQuestionJsonData.append("```\n");
			afterCalculatorPrompt = afterCalculatorPrompt.replace(SUBQUESTION_JSON_DATA, sbSubQuestionJsonData.toString());
		}

		//user's data comparison and analysis processing requirements
		afterCalculatorPrompt = afterCalculatorPrompt.replace(USER_CALCULATOR_REQUIREMENT, calculatorQuestion);
		
		//language
        String langValue = langService.get(lang, "lang");
        afterCalculatorPrompt = afterCalculatorPrompt.replace(LANG, langValue);

		log.info(">>>\n");
		log.info("sessionid:{}, afterCalculatorPrompt:\n{}",sessionid,afterCalculatorPrompt);

		return afterCalculatorPrompt;
	}
	
	public static String getJSONCorrectorUserMessage(String wrongJsonStr) {
		String jsonCorrectorPrompt = FileUtil.getResourceFileLoadAll(JSON_CORRECTOR_PROMPT, "utf-8");
		jsonCorrectorPrompt = jsonCorrectorPrompt.replace(JSON_CORRECTOR_WRONG_JSON, wrongJsonStr);
		log.info(">>>\n");
		log.info("JSONCorrectorUserMessage:\n{}", jsonCorrectorPrompt);
		return jsonCorrectorPrompt;
	}
	
	public static String getAbcProgrammerUserMessage(String sessionId, String question, String serverPort, 
			KnowledgeDao knowledgeDao, int maxKnowledgeResult,
			String lang, LangService langService, List<String> classNames, Map<String, Object> jsonRule,
			String example, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(ABC_PROGRAMMER_PROMPT, "utf-8");
		
		// service port
		prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);

        Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, classNames, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
        prompt = prompt.replace(CLASS_DEF, classDef);

        // business knowledge
		String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, null, question, maxKnowledgeResult, false, false, domainId);
		prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
		prompt = prompt.replace(ABC_PROGRAMMER_EXAMPLE, example);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user question
        prompt = prompt.replace(USER_QUESTION, question);
        
        //language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("sessionid:{}   ABCProgrammerUserMessage:\n{}", sessionId, prompt);
        return prompt;
	}
	
	public static String getABCProgramDescriberUserMessage(ABCHarnessProgram program, String lang, LangService langService, List<String> classNames, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(ABC_PROGRAM_DESCRIBER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, classNames, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, program.getCode());
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("ABCProgramDescriberUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getQuestionCheckerV2UserMessage(String sessionId, String question, List<ABCHarnessProgramDescription> programDescriptions, 
			KnowledgeDao knowledgeDao,
			BusinessConfigService businessConfigService, String lang, LangService langService, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(QUESTION_CHECKER_V2_PROMPT, "utf-8");

        //overall query logic
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < programDescriptions.size(); i++) {
        	ABCHarnessProgramDescription programDescription = programDescriptions.get(i);
        	sb.append("- Sub-program logic " + (i + 1) + ":\n");
        	sb.append("```\n");
        	sb.append(programDescription.getMeaning() + "\n");
        	sb.append("```\n\n");
        }
        prompt = prompt.replace(PROGRAM_DESCRIPTIONS, sb.toString());
        
        //business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, null,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), false, false, domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        //user question
        prompt = prompt.replace(USER_QUESTION, question);
        
        //language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, QuestionCheckerV2UserMessage:\n{}",sessionId,prompt);
        return prompt;
	}
	
	public static String getAbcProgramDashboardMakerUserMessage(ABCHarnessProgram program, String lang, LangService langService, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(ABC_PROGRAM_DASHBOARD_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user question corresponding to the hardcoded code
        prompt = prompt.replace(USER_QUESTION, program.getQuestion());
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, program.getCode());
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getAbcProgramDashboardMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getReadFunctionMakerUserMessage(String question, String code, String lang, LangService langService, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(READ_FUNCTION_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user question corresponding to the hardcoded code
        prompt = prompt.replace(USER_QUESTION, question);
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, code);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getReadFunctionMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getStaticReadFunctionNameMakerUserMessage(Function generalFunction, List<Parameter> parameters, String lang, LangService langService) {
		String prompt = FileUtil.getResourceFileLoadAll(STATIC_READ_FUNCTION_NAME_MAKER_PROMPT, "utf-8");
        
        // general function name
        prompt = prompt.replace(GENERAL_FUNCTION_NAME, generalFunction.getName());
        
        // parameter definition and determined parameter values
        String def = "| Parameter | Description | Type | Determined parameter value |\n| --- | --- | --- | --- |\n";
        for (Parameter parameter : parameters) {
        	def += "| " + parameter.getName() + " | " + parameter.getDescription() + " | " + parameter.getType() + " | " + (parameter.getValue() == null ? "null" : JSON.toJSONString(parameter.getValue(), Feature.WriteMapNullValue)) + " |\n";
        }
        prompt = prompt.replace(PARAMETERS, def);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getStaticReadFunctionNameMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getReadFunctionInstancerUserMessage(String question, List<MetricView> metricViews, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(READ_FUNCTION_INSTANCER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, null,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), false, false, domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // candidate functions
        String functionMd = "";
        for (int i = 0; i < metricViews.size(); i++) {
        	MetricView metricView = metricViews.get(i);
        	functionMd += "## Candidate function " + (i + 1) + "\n";
        	functionMd += "id: " + metricView.getId() + "\n";
        	functionMd += "Parameters:\n";
        	functionMd += "```json\n";
        	JSONArray parameters = new JSONArray();
        	for (Parameter parameter : metricView.getFunction().getParameters()) {
        		JSONObject p = new JSONObject();
        		p.put("name", parameter.getName());
        		p.put("type", parameter.getType());
        		p.put("description", parameter.getDescription());
        		p.put("sample", parameter.getSample());
        		p.put("classNames", parameter.getClassNames());
        		parameters.add(p);
        	}
        	functionMd += JSON.toJSONString(parameters, Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat) + "\n";
        	functionMd += "```\n";
        	functionMd += "Business query logic/meaning: " + metricView.getOriginQuestion() + "\n\n";
        }
        prompt = prompt.replace(METRICVIEWS, functionMd);
        
        // user question
        prompt = prompt.replace(USER_QUESTION, question);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getReadFunctionInstancerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getMetricViewMakerUserMessage(String question, String serverPort, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(METRIC_VIEW_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user requirement
        prompt = prompt.replace(USER_QUESTION, question);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, null,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), false, false, domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // service port
        prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getMetricViewMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getActionMakerUserMessage(String question, String serverPort, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(ACTION_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user requirement
        prompt = prompt.replace(USER_QUESTION, question);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledgeAndExample(knowledgeDao, null, null,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), false, false, domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // service port
        prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getActionMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getActionCodeExplainerUserMessage(List<Parameter> parameters, Map<String, Object> jsonRule, String lang, LangService langService) {
		String prompt = FileUtil.getResourceFileLoadAll(ACTION_CODE_EXPLAINER_PROMPT, "utf-8");
		
		// dataset description
		Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, null, false);
		String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
		prompt = prompt.replace(DATASET_DESC, datasetDesc);
		
		// object class list
		String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
		prompt = prompt.replace(CLASS_DEF, classDef);
		
		// parameter definition
		JSONArray paramsJson = new JSONArray();
		if (parameters != null) {
			for (Parameter parameter : parameters) {
				JSONObject p = new JSONObject();
				p.put("name", parameter.getName());
				p.put("type", parameter.getType());
				p.put("description", parameter.getDescription());
				p.put("sample", parameter.getSample());
				p.put("classNames", parameter.getClassNames());
				paramsJson.add(p);
			}
		}
		prompt = prompt.replace(PARAMETERS, JSON.toJSONString(paramsJson, Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat));
		
		// language
		String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
		
		log.info(">>>\n");
		log.info("getActionCodeExplainerUserMessage:\n{}", prompt);
		return prompt;
	}
	
	public static String getOutputKeyDescriptionMDTable(Map<String, String[]> descriptionMap) {
		String markdown = "| Return field | Function | Class description | Field description | Metric description |\n";
		markdown += "| ---- | ---- | ---- | ---- | ---- |\n";
		for (String as : descriptionMap.keySet()) {
			String[] class_attr_indicator_function = descriptionMap.get(as);
			String classDesc = class_attr_indicator_function[0];
			String attrDesc = class_attr_indicator_function[1];
			String indicatorDesc = class_attr_indicator_function[2];
			String function = class_attr_indicator_function[3];
			markdown += "| " + as + " | " + (function == null || "".equals(function.trim()) ? "none" : function) + " | " + classDesc + " | " + attrDesc + " | " + (indicatorDesc == null || "".equals(indicatorDesc.trim()) ? "none" : indicatorDesc) + " |\n";
		}
		return markdown;
	}

}
