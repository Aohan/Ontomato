package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;

public interface FunctionService {

	/**
	 * The three entrances that generate a Function share one session id convention: {@code sessionId} is the working session id of this call, provided by the caller.
	 * A caller inside data Q&A (function capture) derives it from the request session id per the derived id rule (including a subscript that distinguishes concurrent calls), in the form {@code {request session id}-{suffix}};
	 * Entrances other than data Q&A supply their own id when calling; do not share a fixed id.
	 */
	public Function generateFromDsl(String question, JSONObject dsl, String lang, String domainId, String sessionId);

	public Function generateFromABCProgram(String question, ABCHarnessProgram abcProgram, String lang, String domainId, String sessionId);

	public Function generateStaticFromGeneral(String question, List<Parameter> parameters, Function generalFunction, String lang, String sessionId);
	
	public Function save(Function function, String lang) throws Exception;
	
	public void delete(String id, String lang) throws Exception;
	
	public Function queryById(String id);
	
	public List<Function> queryList(String operation, String className, String domainId);
	
}
