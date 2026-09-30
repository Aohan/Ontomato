package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTask;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessTaskMessage;
import io.ontomato.dataengine.service.ABCHarnessTaskService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ABCHarnessTaskServiceImpl implements ABCHarnessTaskService {
	
	private static final String OP_CREATE_TASK = "OP_CREATE_TASK";
	private static final String OP_GET_TASK = "OP_GET_TASK";
	private static final String OP_PUT_MESSAGE = "OP_PUT_MESSAGE";
	private static final String OP_GET_MESSAGES = "OP_GET_MESSAGES";
	private static final String OP_REMOVE_TASK = "OP_REMOVE_TASK";
	
	@Data
	private class Operation {
		private String type;
		private Object input;
		private BlockingQueue<Object> output;
	}
	
	private BlockingQueue<Operation> queue = new LinkedBlockingQueue<Operation>();

	@Autowired
	private AgentWorkspaceService workspaceService;
	
	@PostConstruct
	public void initService() {
		new Thread(new Runnable() {

			@Override
			public void run() {
				Map<String, ABCHarnessTask> taskMap = new HashMap<String, ABCHarnessTask>();
				while (true) {
					try {
						Operation operation = queue.take();
						if (OP_CREATE_TASK.equals(operation.getType())) {
							ABCHarnessTask task = (ABCHarnessTask)operation.getInput();
							taskMap.put(task.getSessionId(), task);
						} else if (OP_GET_TASK.equals(operation.getType())) {
							String sessionId = (String)operation.getInput();
							BlockingQueue<Object> output = operation.getOutput();
							output.put(Optional.ofNullable(taskMap.get(sessionId)));
						} else if (OP_PUT_MESSAGE.equals(operation.getType())) {
							ABCHarnessTaskMessage message = (ABCHarnessTaskMessage)operation.getInput();
							ABCHarnessTask task = taskMap.get(message.getSessionId());
							if (task != null) {
								List<ABCHarnessTaskMessage> messages = task.getMessages();
								if (messages == null) {
									messages = new ArrayList<ABCHarnessTaskMessage>();
									task.setMessages(messages);
								}
								messages.add(message);
							}
						} else if (OP_GET_MESSAGES.equals(operation.getType())) {
							String sessionId = (String)operation.getInput();
							BlockingQueue<Object> output = operation.getOutput();
							if (output != null) {
								List<ABCHarnessTaskMessage> retMsgs = new ArrayList<ABCHarnessTaskMessage>();
								ABCHarnessTask task = taskMap.get(sessionId);
								if (task != null) {
									List<ABCHarnessTaskMessage> messages = task.getMessages();
									if (messages != null) {
										while (messages.size() > 0) {
											retMsgs.add(messages.removeFirst());
										}
									}
								}
								output.put(retMsgs);
							}
						} else if (OP_REMOVE_TASK.equals(operation.getType())) {
							String sessionId = (String)operation.getInput();
							taskMap.remove(sessionId);
							workspaceService.removeWorkspace(sessionId);
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					
					try {
						Thread.sleep(10L);
					} catch (Exception e) {}
				}
			}
			
		}).start();
	}
	
	@Override
	public void createTask(String sessionId, int timeoutMinutes, String userId, UserDataPermission curUserDataPermission, String lang) throws Exception {
		try {
			ABCHarnessTask task = new ABCHarnessTask();
			task.setSessionId(sessionId.trim());
			task.setTimeoutMinutes(timeoutMinutes);
			task.setUserId(userId);
			task.setCurUserDataPermission(curUserDataPermission);
			task.setLang(lang);
			workspaceService.createWorkspace(sessionId.trim());

			Operation operation = new Operation();
			operation.setType(OP_CREATE_TASK);
			operation.setInput(task);
			queue.add(operation);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw e;
		}
	}
	
	@Override
	public ABCHarnessTask getTaskBySessionId(String sessionId) {
		BlockingQueue<Object> output = new LinkedBlockingQueue<Object>();
		try {
			Operation operation = new Operation();
			operation.setType(OP_GET_TASK);
			operation.setInput(sessionId.trim());
			operation.setOutput(output);
			queue.add(operation);
			ABCHarnessTask task = ((Optional<ABCHarnessTask>)output.take()).orElse(null);
			return task;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return null;
		} finally {
			output = null;
		}
	}

	@Override
	public void pushMessage(ABCHarnessTaskMessage message) {
		try {
			Operation operation = new Operation();
			operation.setType(OP_PUT_MESSAGE);
			operation.setInput(message);
			queue.add(operation);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public List<ABCHarnessTaskMessage> takeMessages(String sessionId) {
		BlockingQueue<Object> output = new LinkedBlockingQueue<Object>();
		Operation operation = new Operation();
		operation.setType(OP_GET_MESSAGES);
		operation.setInput(sessionId.trim());
		operation.setOutput(output);
		queue.add(operation);
		boolean interrupted = Thread.interrupted();
		try {
			// The consume operation is already enqueued, so this batch of messages must be taken back; the cancel flag is handed back to the caller, avoiding the result falling into a queue that nobody reads.
			while (true) {
				try { return (List<ABCHarnessTaskMessage>)output.take(); }
				catch (InterruptedException e) { interrupted = true; }
			}
		} finally {
			if (interrupted) Thread.currentThread().interrupt();
		}
	}
	
	@Override
	public void removeTask(String sessionId) {
		try {
			Operation operation = new Operation();
			operation.setType(OP_REMOVE_TASK);
			operation.setInput(sessionId);
			queue.add(operation);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

}
