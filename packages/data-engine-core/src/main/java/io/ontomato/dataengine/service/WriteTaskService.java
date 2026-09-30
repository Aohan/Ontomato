package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.bean.task.WriteTask;
import io.ontomato.dataengine.bean.task.WriteTaskResult;
import io.ontomato.dataengine.core.bean.Page;

public interface WriteTaskService {

	public WriteTask save(WriteTask writeTask, String lang) throws Exception;
	
	public void delete(String id) throws Exception;
	
	public WriteTask queryById(String id);
	
	public List<WriteTask> queryList(String status, String functionId, String className, String domainId);
	
	public WriteTaskResult queryResultById(String writeTaskResultId);
	
	public Page<WriteTaskResult> queryResultPageByTaskId(String writeTaskId, Integer pageNum, Integer pageSize);
	
	public void runOnce(String id, String lang) throws Exception;
	
}
