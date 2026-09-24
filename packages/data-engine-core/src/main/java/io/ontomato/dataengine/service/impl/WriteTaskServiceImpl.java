package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.task.WriteTask;
import io.ontomato.dataengine.bean.task.WriteTaskResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.WriteTaskDao;
import io.ontomato.dataengine.dao.WriteTaskResultDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.WriteTaskService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class WriteTaskServiceImpl implements WriteTaskService {
	
	@Autowired
    private DataRagConfig dataRagConfig;
	
	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private LangService langService;
	
	@Autowired
	private WriteTaskDao writeTaskDao;
	
	@Autowired
	private WriteTaskResultDao writeTaskResultDao;
	
	@Autowired
	private FunctionDao functionDao;
	
	@Autowired
	private ABCProgramService abcProgramService;
	
	@Autowired
    private TaskScheduler taskScheduler;
	
	private final Map<String, ScheduledFuture<?>> taskMap = new ConcurrentHashMap<>();
	private final Map<String, String> cronMap = new ConcurrentHashMap<>();
	private final Map<String, String> codeMap = new ConcurrentHashMap<>();
	
	@PostConstruct
	public void initService() {
		String lang = "en";
		
		// Every minute, check the changes of the tasks of this serviceId to decide starting and stopping the runtime tasks
		new Thread(new Runnable() {
			@Override
			public void run() {
				while (true) {
					try {
						List<WriteTask> writeTasks = queryList(null, null, null, null);
						Map<String, WriteTask> shouldRunTaskMap = new HashMap<String, WriteTask>();
						Map<String, WriteTask> shouldStopTaskMap = new HashMap<String, WriteTask>();
						for (WriteTask writeTask : writeTasks) {
							if (dataRagConfig.getServiceId().equals(writeTask.getServiceId())) {
								if (WriteTask.STATUS_RUNNING.equals(writeTask.getStatus())) {
									shouldRunTaskMap.put(writeTask.getId(), writeTask);
								} else if (WriteTask.STATUS_STOPPED.equals(writeTask.getStatus())) {
									shouldStopTaskMap.put(writeTask.getId(), writeTask);
								}
							}
						}
						
						for (String id : shouldRunTaskMap.keySet()) {
							WriteTask shouldRunTask = shouldRunTaskMap.get(id);
							String cron = cronMap.get(id);
							String code = codeMap.get(id);
							if (cron == null || !shouldRunTask.getCron().equals(cron) || !shouldRunTask.getFunction().getCode().equals(code)) {
								BusinessConfig businessConfig = businessConfigService.get(shouldRunTask.getDomainId());
								Runnable runnable = generateRunnableFromWriteTask(shouldRunTask, businessConfig.getReportCardPythonTimeout(), lang, shouldRunTask.getDomainId());
								addTask(id, shouldRunTask.getName(), shouldRunTask.getCron(), shouldRunTask.getFunction().getCode(), runnable);
							}
						}
						
						for (String id : shouldStopTaskMap.keySet()) {
							stopTask(id);
						}
						for (String id : cronMap.keySet()) {
							if (shouldRunTaskMap.get(id) == null) {
								stopTask(id);
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					
					try {
						Thread.sleep(60000);
					} catch (Exception e) {}
				}
			}
		}).start();
	}
	
	@Override
	public WriteTask save(WriteTask writeTask, String lang) throws Exception {
		if (writeTask.getId() != null) {
			Object[] exist = writeTaskDao.queryById(writeTask.getId());
			if (exist == null) {
				throw new Exception(langService.get(lang, "WriteTask.notFound"));
			} else {
				WriteTask existWriteTask = (WriteTask)exist[0];
				if (!writeTask.getDomainId().equals(existWriteTask.getDomainId())) {
					throw new Exception(langService.get(lang, "WriteTask.domainMismatch"));
				}
				writeTask.setServiceId(existWriteTask.getServiceId());
			}
		} else {
			writeTask.setServiceId(dataRagConfig.getServiceId());
		}
		if (writeTask.getFunction() != null) {
			Function function = writeTask.getFunction();
			Function existFunction = functionDao.queryById(function.getId());
			if (existFunction != null) {
				if (!Function.OPERATION_WRITE.equals(existFunction.getOperation())) {
					throw new Exception(langService.get(lang, "Function.notWrite"));
				}
				if (existFunction.getParameters() == null || existFunction.getParameters().size() > 0) {
					throw new Exception(langService.get(lang, "WriteTask.functionMustBeNoParam"));
				}
			} else {
				throw new Exception(langService.get(lang, "Function.notFound"));
			}
			writeTask.setFunction(existFunction);
		} else {
			throw new Exception(langService.get(lang, "Function.cannotBeEmpty"));
		}
		if (!WriteTask.STATUS_RUNNING.equals(writeTask.getStatus()) &&
				!WriteTask.STATUS_STOPPED.equals(writeTask.getStatus())) {
			throw new Exception(langService.get(lang, "WriteTask.invalidStatus"));
		}
		try {
			new CronTrigger(writeTask.getCron());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception(langService.get(lang, "WriteTask.invalidCrontab"));
		}
		writeTask = writeTaskDao.save(writeTask);
		return writeTask;
	}

	@Override
	public void delete(String id) throws Exception {
		writeTaskDao.delete(id);
	}
	
	// Start task
	private String addTask(String id, String name, String cron, String code, Runnable task) {
        stopTask(id); // Stop the task with the same name first
        ScheduledFuture<?> future = taskScheduler.schedule(task, new CronTrigger(cron));
        taskMap.put(id, future);
        cronMap.put(id, cron);
        codeMap.put(id, code);
        log.info("Write FUNCTION task [{} {}] started, cron: {}", id, name, cron);
        return id;
    }
	
	// Stop task
	private void stopTask(String id) {
        ScheduledFuture<?> future = taskMap.remove(id);
        cronMap.remove(id);
        codeMap.remove(id);
        if (future != null) {
            future.cancel(false); // false = do not interrupt the task being executed
            log.info("Write FUNCTION task [{}] stopped", id);
        }
    }
	
	private Runnable generateRunnableFromWriteTask(WriteTask writeTask, int timeout, String lang, String domainId) {
    	String id = writeTask.getId();
    	return new Runnable() {
			@Override
			public void run() {
				log.info("Write FUNCTION task [" + id + "] started executing...");
				try {
					Long now = System.currentTimeMillis();
					Object[] ret = abcProgramService.execute(id, writeTask.getFunction(), null, new UserDataPermission(), ServiceConst.NOT_SANDBOX, "en", timeout, writeTask.getDomainId());
					PythonExecuteResult result = (PythonExecuteResult)ret[1];
					String content = result.getResult();
					String error = result.getError();
					WriteTaskResult writeTaskResult = new WriteTaskResult();
					writeTaskResult.setWriteTaskId(writeTask.getId());
					writeTaskResult.setExecuteTimestamp(now);
					writeTaskResult.setResult(content);
					writeTaskResult.setError(error);
					writeTaskResult.setSpendTime(result.getSpendTime());
					writeTaskResultDao.save(writeTaskResult);
					if (error != null) {
						throw new Exception(error);
					}
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
				log.info("Write FUNCTION task [" + id + "] execution finished");
			}
		};
    }

	@Override
	public WriteTask queryById(String id) {
		Object[] o = writeTaskDao.queryById(id);
		if (o != null) {
			WriteTask writeTask = (WriteTask)o[0];
			String functionId = (String)o[1];
			Function function = functionDao.queryById(functionId);
			writeTask.setFunction(function);
			return writeTask;
		} else {
			return null;
		}
	}

	@Override
	public List<WriteTask> queryList(String status, String functionId, String className, String domainId) {
		List<Object[]> oList = writeTaskDao.queryList(status, functionId, className, domainId);
		List<Function> functions = functionDao.queryList(null, null, null);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<WriteTask> writeTasks = new ArrayList<WriteTask>();
		for (Object[] o : oList) {
			WriteTask writeTask = (WriteTask)o[0];
			String fId = (String)o[1];
			writeTask.setFunction(functionMap.get(fId));
			writeTasks.add(writeTask);
		}
		return writeTasks;
	}
	
	@Override
	public WriteTaskResult queryResultById(String writeTaskResultId) {
		return writeTaskResultDao.queryById(writeTaskResultId);
	}
	
	@Override
	public Page<WriteTaskResult> queryResultPageByTaskId(String writeTaskId, Integer pageNum, Integer pageSize) {
		if (pageSize == null || pageSize <= 0) {
			pageSize = 20;
		}
		if (pageNum == null || pageNum <= 0) {
			pageNum = 1;
		}
		return writeTaskResultDao.queryPageByWriteTaskId(writeTaskId, pageNum, pageSize);
	}
	
	@Override
	public void runOnce(String id, String lang) throws Exception {
		log.info("Write FUNCTION task [" + id + "] started executing...");
		WriteTask writeTask = queryById(id);
		if (writeTask != null) {
			BusinessConfig businessConfig = businessConfigService.get(writeTask.getDomainId());
			Long now = System.currentTimeMillis();
			Object[] ret = abcProgramService.execute(id, writeTask.getFunction(), null, new UserDataPermission(), ServiceConst.NOT_SANDBOX, "en", businessConfig.getReportCardPythonTimeout(), writeTask.getDomainId());
			PythonExecuteResult result = (PythonExecuteResult)ret[1];
			String content = result.getResult();
			String error = result.getError();
			WriteTaskResult writeTaskResult = new WriteTaskResult();
			writeTaskResult.setWriteTaskId(writeTask.getId());
			writeTaskResult.setExecuteTimestamp(now);
			writeTaskResult.setResult(content);
			writeTaskResult.setError(error);
			writeTaskResult.setSpendTime(result.getSpendTime());
			writeTaskResultDao.save(writeTaskResult);
			if (error != null) {
				throw new Exception(error);
			}
		} else {
			throw new Exception(langService.get(lang, "WriteTask.notFound"));
		}
		log.info("Write FUNCTION task [" + id + "] execution finished");
	}

}
