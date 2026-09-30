package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;

public interface ABCProgramDashboardService {

	public ABCHarnessDashboard fromProgram(ABCHarnessProgram program, boolean needParameter, String lang, String domainId) throws Exception;
	
}
