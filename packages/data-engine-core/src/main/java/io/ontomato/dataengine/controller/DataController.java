package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class DataController {
	
	@Autowired
    private IdentityService identityService;
	
	@Autowired
    private DataService dataService;
	
	@GetMapping("/data/refreshStarChartData")
    @ResponseBody
    public Boolean refreshStarChartData() {
		User user = SystemUtils.getCurUser();
		dataService.refreshStarChartData(user.getDomainId());
		return true;
	}
	
	@GetMapping("/data/queryWholeData")
    @ResponseBody
    public JSONObject queryWholeData() {
		User user = SystemUtils.getCurUser();
		return dataService.queryWholeDataMode0(user.getDomainId());
	}

	@GetMapping("/data/queryWholeDataMode0")
    @ResponseBody
    public JSONObject queryWholeDataMode0() {
		User user = SystemUtils.getCurUser();
		return dataService.queryWholeDataMode0(user.getDomainId());
	}
	
	@GetMapping("/data/queryWholeDataMode1")
    @ResponseBody
    public JSONObject queryWholeDataMode1() {
		User user = SystemUtils.getCurUser();
		return dataService.queryWholeDataMode1(user.getDomainId());
	}
	
	@PostMapping("/data/queryNextByNode")
    @ResponseBody
    public JSONObject queryNextByNode(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		User user = SystemUtils.getCurUser();
		return dataService.queryNextByNode(param, lang, user.getDomainId());
	}
	
	@PostMapping("/data/queryInfoByNode")
    @ResponseBody
    public JSONObject queryInfoByNode(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		return dataService.queryInfoByNode(param, lang, curUserDataPermission, user.getDomainId());
	}

	/**Perform a full-text search on all classes
	 * @param param
	 * @return
	 */
	@PostMapping("/data/fulltextsearch")
	@ResponseBody
	public JSONObject fullTextSearch(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		JSONObject searchResult = dataService.fullTextSearch(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}

	@GetMapping("/data/getclassandcount")
	@ResponseBody
	public JSONObject getClassAndCount(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		JSONObject searchResult = dataService.getClassAndCount(lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}

	@PostMapping("/data/getclassdatabypage")
	@ResponseBody
	public JSONObject getClassDataByPage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		JSONObject searchResult = dataService.getClassDataByPage(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}
	
	@PostMapping("/data/getWholeClassDataByPage")
	@ResponseBody
	public JSONObject getWholeClassDataByPage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		JSONObject searchResult = dataService.getWholeClassDataByPage(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}
	
	@PostMapping("/data/queryDistinctAttrValue")
	@ResponseBody
	public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String query = param.getString("query");
			List<String> values = dataService.queryDistinctAttrValue(className, attrName, query, curUserDataPermission, user.getDomainId());
			ret.put("data", values);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

}
