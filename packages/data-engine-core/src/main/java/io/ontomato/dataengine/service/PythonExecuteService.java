package io.ontomato.dataengine.service;

import java.io.File;

import io.ontomato.dataengine.bean.PythonExecuteResult;

public interface PythonExecuteService {

	public PythonExecuteResult runPythonCode(String sessionid, String pythonCode, int timeoutMinute, String lang, String... args) throws Exception;

	public PythonExecuteResult runPythonFile(String sessionId, File file, int timeoutMinute, String lang, String... args) throws Exception;
	
}
