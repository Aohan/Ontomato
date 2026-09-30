package io.ontomato.dataengine.service;

import java.io.File;
import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ABCProgramService {

	public JSONArray execute(String sessionId, ABCHarnessProgram program, String userId, UserDataPermission curUserDataPermission, String lang, int timeoutMinutes, String domainId) throws Exception;
	
	public JSONArray execute(String sessionId, ABCHarnessDashboard dashboard, String userId, UserDataPermission curUserDataPermission, String lang, int timeoutMinutes, String domainId) throws Exception;
	
	public Object[] execute(String sessionId, Function function, String userId, UserDataPermission curUserDataPermission, String sandboxId, String lang, int timeoutMinutes, String domainId) throws Exception;
	
	public JSONArray dealPythonReturn(String pythonOutput, String errorMessage, List<ABCHarnessProgramOutKeyRef> outKeyRefs, UserDataPermission curUserDataPermission) throws Exception;
	
	public File getBaseWorkspace();
	
}
