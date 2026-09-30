package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ABCHarnessService {

	public void abcHarness(String sessionId, String question, List<String> classNames, String lang, UserDataPermission curUserDataPermission, User user);
	
}
