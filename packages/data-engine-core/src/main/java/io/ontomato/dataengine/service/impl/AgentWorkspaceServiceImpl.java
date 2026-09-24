package io.ontomato.dataengine.service.impl;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import io.ontomato.dataengine.service.AgentWorkspaceService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class AgentWorkspaceServiceImpl implements AgentWorkspaceService {

	private static class SessionWorkspace {
		final Path root;
		final ConcurrentHashMap<String, FileExecution> executions = new ConcurrentHashMap<>();
		/** Content of the successfully submitted file; when submitted multiple times, the last one prevails. */
		volatile String submission;

		SessionWorkspace(Path root) {
			this.root = root;
		}
	}

	private final ConcurrentHashMap<String, SessionWorkspace> workspaces = new ConcurrentHashMap<>();

	@Override
	public void createWorkspace(String sessionId) throws Exception {
		try {
			Path base = Files.createDirectories(Path.of("python", "harness-workspaces"));
			Path root = Files.createTempDirectory(base, "run-").toRealPath();
			workspaces.put(sessionId.trim(), new SessionWorkspace(root));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw e;
		}
	}

	@Override
	public Path workspaceRoot(String sessionId) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		return workspace == null ? null : workspace.root;
	}

	@Override
	public Path resolve(String sessionId, String path) throws Exception {
		if (path == null || path.isBlank() || Path.of(path).isAbsolute()) {
			throw new IllegalArgumentException("File path must be a relative path within the current workspace");
		}
		SessionWorkspace workspace = workspaces.get(sessionId);
		if (workspace == null) throw new IllegalStateException("This task has ended");
		Path root = workspace.root;
		Path file = root.resolve(path).normalize();
		if (!file.startsWith(root)) throw new IllegalArgumentException("File path is outside the current workspace");
		for (Path part = file; part != null && part.startsWith(root); part = part.getParent()) {
			if (Files.isSymbolicLink(part)) throw new IllegalArgumentException("The file tool does not support symbolic links");
		}
		return file;
	}

	@Override
	public void removeWorkspace(String sessionId) {
		try {
			SessionWorkspace workspace = workspaces.remove(sessionId);
			if (workspace != null) {
				try (var files = Files.walk(workspace.root)) {
					for (Path file : files.sorted(Comparator.reverseOrder()).toList()) {
						Files.deleteIfExists(file);
					}
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void clearExecution(String sessionId, String fileKey) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		if (workspace != null) {
			workspace.executions.remove(fileKey);
		}
	}

	@Override
	public void saveExecution(String sessionId, String fileKey, FileExecution execution) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		if (workspace != null) {
			workspace.executions.put(fileKey, execution);
		}
	}

	@Override
	public FileExecution getExecution(String sessionId, String fileKey) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		return workspace == null ? null : workspace.executions.get(fileKey);
	}

	@Override
	public void saveSubmission(String sessionId, String content) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		if (workspace != null) {
			workspace.submission = content;
		}
	}

	@Override
	public String getSubmission(String sessionId) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		return workspace == null ? null : workspace.submission;
	}

	@Override
	public void clearSubmission(String sessionId) {
		SessionWorkspace workspace = workspaces.get(sessionId);
		if (workspace != null) {
			workspace.submission = null;
		}
	}

}
