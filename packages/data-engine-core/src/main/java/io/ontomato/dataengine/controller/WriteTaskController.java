package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.task.WriteTask;
import io.ontomato.dataengine.bean.task.WriteTaskResult;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.WriteTaskService;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class WriteTaskController {
	
	@Autowired
	private WriteTaskService writeTaskService;

	@PostMapping("/writeTask/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			WriteTask writeTask = param.to(WriteTask.class);
			writeTask.setDomainId(user.getDomainId());
			writeTaskService.save(writeTask, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			writeTaskService.delete(id);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			WriteTask writeTask = writeTaskService.queryById(id);
			ret.put("success", true);
			ret.put("data", writeTask);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param.getString("status");
			String className = param.getString("className");
			List<WriteTask> writeTasks = writeTaskService.queryList(status, null, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", writeTasks);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/runOnce")
    @ResponseBody
    public JSONObject runOnce(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			writeTaskService.runOnce(id, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/queryResultById")
    @ResponseBody
    public JSONObject queryResultById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String resultId = param.getString("resultId");
			WriteTaskResult writeTaskResult = writeTaskService.queryResultById(resultId);
			ret.put("success", true);
			ret.put("data", writeTaskResult);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/writeTask/queryResultPageByTaskId")
    @ResponseBody
    public JSONObject queryResultPageByTaskId(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			Integer pageNum = param.getInteger("pageNum");
			Integer pageSize = param.getInteger("pageSize");
			Page<WriteTaskResult> page = writeTaskService.queryResultPageByTaskId(id, pageNum, pageSize);
			ret.put("success", true);
			ret.put("data", page);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
