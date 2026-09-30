package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;

public interface CheckServiceV2 {

	public void saveCheckTask(ABCHarnessCheck check);
	
	public void check(ABCHarnessCheck check, List<ABCHarnessProgram> programs, List<String> classNames, String domainId);
	
	public ABCHarnessCheck queryBySessionId(String sessionId);
	
}
