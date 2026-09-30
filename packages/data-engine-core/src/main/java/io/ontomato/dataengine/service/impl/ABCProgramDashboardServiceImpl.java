package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.service.ABCProgramDashboardService;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.tools.DashboardSubmitTools;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.UserMessageUtil;

@Service
public class ABCProgramDashboardServiceImpl implements ABCProgramDashboardService {
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
	private ABCProgramService abcProgramService;
	
	@Autowired
    private LangService langService;
	
	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
	@Override
	public ABCHarnessDashboard fromProgram(ABCHarnessProgram program, boolean needParameter, String lang, String domainId) throws Exception {
		if (needParameter) {
			// Call the dashboard maker
			String sessionId = UUID.randomUUID().toString();
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sessionId);
			originalQuestion.setQuestion(program.getQuestion());
			BusinessConfig businessConfig = businessConfigService.get(domainId);
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		String userMessage = UserMessageUtil.getAbcProgramDashboardMakerUserMessage(program, lang, langService, jsonRule);
		try {
			agentWorkspaceService.createWorkspace(sessionId);
		} catch (Exception e) {
			// If workspace creation fails, tool calls will error out directly; this round is treated as having no submission
		}
		try {
		multiThreadAIChatService.chat(
				MultiThreadAIChatService.ABC_PROGRAM_DASHBOARD_MAKER,
				originalQuestion,
				sessionId,
				userMessage,
				ModelResolver.resolve(businessConfig, AgentRole.CODING, langService),
				domainId);
		
		// Deliveries come only from submission registration
		String submitted = agentWorkspaceService.getSubmission(sessionId);
		if (submitted == null) {
			return null;
		}
		JSONObject envelope = null;
		try {
			envelope = JSONObject.parseObject(submitted);
		} catch (Exception e) {
			return null;
		}
		String code = envelope.getString(DashboardSubmitTools.CODE_KEY);
		String title = envelope.getString(DashboardSubmitTools.TITLE_KEY);
		JSONArray defsArray = envelope.getJSONArray(DashboardSubmitTools.PARAMETER_DEFS_KEY);
		if (code == null || title == null || defsArray == null) {
			return null;
		}
		List<ABCHarnessDashboardParameter> parameters =
				JSONArray.parseArray(defsArray.toJSONString(), ABCHarnessDashboardParameter.class);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (ABCHarnessDashboardParameter parameter : parameters) {
			parameter.setClassName(DBSchemaUtil.normalizeClassName(parameter.getClassName(), classDefs));
		}
		ABCHarnessDashboard dashboard = new ABCHarnessDashboard();
		dashboard.setTitle(title.trim());
		dashboard.setCode(code);
		dashboard.setOutKeyRefs(program.getOutKeyRefs());
		dashboard.setParameters(parameters);
		
		// Test
		int timeoutMinutes = 10;
		JSONArray dashboardResult = abcProgramService.execute(UUID.randomUUID().toString(), dashboard, "admin", new UserDataPermission(), lang, timeoutMinutes, domainId);
		JSONArray originResult = abcProgramService.execute(UUID.randomUUID().toString(), program, "admin", new UserDataPermission(), lang, timeoutMinutes, domainId);
		if (dashboardResult.toString(Feature.MapSortField).equals(originResult.toString(Feature.MapSortField))) {
			return dashboard;
		}
		return null;
		} finally {
			agentWorkspaceService.removeWorkspace(sessionId);
		}
		} else {
			ABCHarnessDashboard dashboard = new ABCHarnessDashboard();
    		dashboard.setTitle(program.getQuestion());
    		dashboard.setCode(program.getCode());
    		dashboard.setOutKeyRefs(program.getOutKeyRefs());
    		dashboard.setParameters(new ArrayList<ABCHarnessDashboardParameter>());
    		return dashboard;
		}
	}

}
