package io.ontomato.dataengine.service;

import java.nio.file.Path;

import io.ontomato.dataengine.bean.PythonExecuteResult;

/**
 * Generic per-sessionId Agent file workspace: create, get, clear, and per-file execution state.
 * Depends on no ABC harness types, reused by all Agent runs.
 */
public interface AgentWorkspaceService {

	/** Content and result of the most recent execution of a file; an empty error means success, reused for validation on submission. Python execution also carries the full result for delivery reuse, while DSL execution keeps only success or failure. */
	public record FileExecution(String content, String error, PythonExecuteResult pythonResult) {}

	public void createWorkspace(String sessionId) throws Exception;

	public Path workspaceRoot(String sessionId);

	public Path resolve(String sessionId, String path) throws Exception;

	public void removeWorkspace(String sessionId);

	public void clearExecution(String sessionId, String fileKey);

	public void saveExecution(String sessionId, String fileKey, FileExecution execution);

	public FileExecution getExecution(String sessionId, String fileKey);

	/** Content of a successfully submitted file; on repeated submissions the last one wins, cleared along with the workspace. */
	public void saveSubmission(String sessionId, String content);

	public String getSubmission(String sessionId);

	/** Clears the submission record of the session; a submission is valid per round, call this before the next round starts. */
	public void clearSubmission(String sessionId);

}
