package io.ontomato.dataengine.bean.abcHarness;

import java.util.List;

import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.Data;

@Data
public class ABCHarnessTask {
	
	private String sessionId;
	private int timeoutMinutes;
	private String userId;
	private UserDataPermission curUserDataPermission;
	private String lang;
	private List<ABCHarnessTaskMessage> messages;
	
}
