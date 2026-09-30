package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTask;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTaskMessage;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ABCHarnessTaskService {
	
	public void createTask(String sessionId, int timeoutMinutes, String userId, UserDataPermission curUserDataPermission, String lang) throws Exception;

	public ABCHarnessTask getTaskBySessionId(String sessionId);

	public void pushMessage(ABCHarnessTaskMessage message);
	
	public List<ABCHarnessTaskMessage> takeMessages(String sessionId);
	
	public void removeTask(String sessionId);
	
}
