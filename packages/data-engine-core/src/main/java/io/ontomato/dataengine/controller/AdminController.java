package io.ontomato.dataengine.controller;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.config.ControllerConst;
import org.springframework.web.bind.annotation.RequestHeader;

@Slf4j
@RestController
public class AdminController {

	@Autowired
	private AdminService adminService;

	@Autowired
	private KnowledgeService knowledgeService;

	@Autowired
	private IdentityService identityService;

	@Autowired
	private LangService langService;

	@PostMapping("/admin/editdatasetdesc")
	@ResponseBody
	public JSONObject editDataSetDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String strDataSetDesc = param.getString("datasetdesc").trim();
			if (strDataSetDesc !=null && !"".equals(strDataSetDesc)) {
				User user = SystemUtils.getCurUser();
				adminService.setDataSetDesc(strDataSetDesc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/addRelationship")
    @ResponseBody
    public JSONObject addRelationship(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String relationName = param.getString("relationName").trim();
			String fromClassName = param.getString("fromClassName").trim();
			String toClassName = param.getString("toClassName").trim();
			String relationDesc = param.getString("relationDesc").trim();
			String fromField = param.getString("fromField");
			String toField = param.getString("toField");
			if (!"".equals(relationName) && !"".equals(fromClassName) && !"".equals(toClassName) && !"".equals(relationDesc)) {
				User user = SystemUtils.getCurUser();
				adminService.addRelationship(relationName, fromClassName, toClassName, relationDesc, fromField, toField, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/delRelationship")
    @ResponseBody
    public JSONObject delRelationship(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String relationName = param.getString("relationName").trim();
			if (!"".equals(relationName)) {
				User user = SystemUtils.getCurUser();
				adminService.delRelationship(relationName, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/admin/editRelationshipDesc")
    @ResponseBody
    public JSONObject editRelationshipDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String relationship = param.getString("relationship").trim();
			String desc = param.getString("desc").trim();
			if (!"".equals(relationship) && !"".equals(desc)) {
				User user = SystemUtils.getCurUser();
				adminService.setRelationshipDesc(relationship, desc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/addClass")
    @ResponseBody
    public JSONObject addClass(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String primaryKeyName = param.getString("primaryKeyName");
			String showName = param.getString("showName").trim();
			String classDesc = param.getString("classDesc").trim();
			// The card and star-chart flags are optional in the API and default to false; the description may be empty.
			boolean classToCard = param.getBooleanValue("classToCard");
			boolean instanceToCard = param.getBooleanValue("instanceToCard");
			boolean inStarChart = param.getBooleanValue("inStarChart");
			if ("".equals(className) || "".equals(showName)) {
				throw new Exception(langService.get(lang, "Admin.class.nameRequired"));
			}
			User user = SystemUtils.getCurUser();
			adminService.addClass(className, primaryKeyName, showName, classDesc, classToCard, instanceToCard, inStarChart, lang, user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/delClass")
    @ResponseBody
    public JSONObject delClass(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			if (!"".equals(className)) {
				User user = SystemUtils.getCurUser();
				adminService.delClass(className, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassDesc")
    @ResponseBody
    public JSONObject editClassDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String desc = param.getString("desc").trim();
			if (!"".equals(className) && !"".equals(desc)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassDesc(className, desc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassShowName")
    @ResponseBody
    public JSONObject editClassShowName(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String showName = param.getString("showName").trim();
			if (!"".equals(className) && !"".equals(showName)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassShowName(className, showName, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassInStarChart")
    @ResponseBody
    public JSONObject editClassInStarChart(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			boolean inStarChart = param.getBoolean("inStarChart");
			if (!"".equals(className)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassInStarChart(className, inStarChart, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/addClassAttr")
    @ResponseBody
    public JSONObject addClassAttr(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			String showName = param.getString("showName").trim();
			String attrDesc = param.getString("attrDesc").trim();
			String type = param.getString("type").trim();
			boolean bizzKey = param.getBoolean("bizzKey");
			boolean enable = param.getBoolean("enable");
			if (!"".equals(className) && !"".equals(attrName) && !"".equals(showName) && !"".equals(attrDesc) && !"".equals(type)) {
				User user = SystemUtils.getCurUser();
				adminService.addClassAttr(className, attrName, showName, attrDesc, type, bizzKey, enable, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/delClassAttr")
    @ResponseBody
    public JSONObject delClassAttr(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			if (!"".equals(className) && !"".equals(attrName)) {
				User user = SystemUtils.getCurUser();
				adminService.delClassAttr(className, attrName, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassAttrDesc")
    @ResponseBody
    public JSONObject editClassAttrDesc(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String desc = param.getString("desc").trim();
			String enable = param.getString("enable").trim();
			// An empty description is a valid value (a new primary key is saved with one).
			if (!"".equals(className) && !"".equals(attr)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrDesc(className, attr, desc, enable, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassAttrShowName")
    @ResponseBody
    public JSONObject editClassAttrShowName(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String showName = param.getString("showName").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(showName)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrShowName(className, attr, showName, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassAttrTimeFormat")
    @ResponseBody
    public JSONObject editClassAttrTimeFormat(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String format = param.getString("format").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(format)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrTimeFormat(className, attr, format, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassAttrShouldReturn")
    @ResponseBody
    public JSONObject editClassAttrShouldReturn(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			boolean shouldReturn = param.getBoolean("shouldReturn");
			if (!"".equals(className) && !"".equals(attr)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrShouldReturn(className, attr, shouldReturn, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/admin/setClassAttrPermissionField")
	@ResponseBody
	public JSONObject setClassAttrPermissionField(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String attr = param.getString("attr");
			boolean permissionField = param.getBooleanValue("permissionField");
			User user = SystemUtils.getCurUser();
			adminService.setClassAttrPermissionField(className, attr, permissionField, user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editClassAttrPrimaryKey")
    @ResponseBody
    public JSONObject editClassAttrPrimaryKey(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			if (!"".equals(className) && !"".equals(attr)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrPrimaryKey(className, attr, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/addBucketIndicator")
    @ResponseBody
    public JSONObject addBucketIndicator(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			String indicatorName = param.getString("indicatorName").trim();
			String indicatorDesc = param.getString("indicatorDesc").trim();
			String indicatorUnit = param.getString("indicatorUnit").trim();
			if (!"".equals(className) && !"".equals(attrName) && !"".equals(indicatorName) && !"".equals(indicatorDesc) && !"".equals(indicatorUnit)) {
				User user = SystemUtils.getCurUser();
				adminService.addBucketIndicator(className, attrName, indicatorName, indicatorDesc, indicatorUnit, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/delBucketIndicator")
    @ResponseBody
    public JSONObject delBucketIndicator(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			String indicatorName = param.getString("indicatorName").trim();
			if (!"".equals(className) && !"".equals(attrName) && !"".equals(indicatorName)) {
				User user = SystemUtils.getCurUser();
				adminService.delBucketIndicator(className, attrName, indicatorName, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editBucketIndicatorDesc")
    @ResponseBody
    public JSONObject editBucketIndicatorDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String indicator = param.getString("indicator").trim();
			String desc = param.getString("desc").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(indicator) && !"".equals(desc)) {
				User user = SystemUtils.getCurUser();
				adminService.setBucketIndicatorDesc(className, attr, indicator, desc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editBucketIndicatorUnit")
    @ResponseBody
    public JSONObject editBucketIndicatorUnit(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String indicator = param.getString("indicator").trim();
			String unit = param.getString("unit").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(indicator)) {
				User user = SystemUtils.getCurUser();
				adminService.setBucketIndicatorUnit(className, attr, indicator, unit, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/getMetas")
    @ResponseBody
    public JSONObject getMetas(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getJSONRule(user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/admin/getschemamarkdown")
	@ResponseBody
	public JSONObject getSchemaMarkdown(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getSchemaMarkdown(param.getList("classNames", String.class), user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/getschemamarkdown-v2")
	@ResponseBody
	public JSONObject getSchemaMarkdownV2(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getSchemaMarkdownV2(param.getList("classNames", String.class), user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@GetMapping("/admin/getDatasetDesc")
	@ResponseBody
	public JSONObject getDatasetDesc() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			ret.put("success", true);
			ret.put("data", rule.getString("datasetDesc"));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@GetMapping("/admin/getAllClassNames")
	@ResponseBody
	public JSONObject getAllClassNames() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			List<String> classNames = new ArrayList<String>();
			JSONArray classDefs = rule.getJSONArray("classDefs");
			for (int i = 0; i < classDefs.size(); i++) {
				JSONObject classDef = classDefs.getJSONObject(i);
				classNames.add(classDef.getString("name"));
			}
			ret.put("success", true);
			ret.put("data", classNames);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/getSchemaByClassName")
	@ResponseBody
	public JSONObject getSchemaByClassName(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<String> classNames = param.getList("classNames", String.class);
			ret.put("success", true);
			ret.put("data", adminService.getSchemaByClassName(classNames, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/getRelationshipByClassNames")
	@ResponseBody
	public JSONObject getRelationshipByClassNames(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<String> classNames = param.getList("classNames", String.class);
			ret.put("success", true);
			ret.put("data", adminService.getRelationshipByClassNames(classNames, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/queryDistinctAttrValue")
	@ResponseBody
	public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			UserDataPermission permission = identityService.getCurrentUserDataPermission();
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String like = param.getString("like");
			Integer limit = param.getInteger("limit");
			ret.put("success", true);
			ret.put("data", adminService.queryDistinctAttrValue(className, attrName, like, limit == null ? 0 : limit, permission, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/admin/addBussinessKnowledge")
    @ResponseBody
    public JSONObject addBussinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String knowledgeID = param.getString("knowledgeID");
			String knowledgeTitle = param.getString("knowledgeTitle").trim();
			String bk = param.getString("knowledgeText").trim();
			int status = param.getInteger("status");
			List<String> listknowledgeTags = param.getList("knowledgeTags", String.class);
			if (!"".equals(bk)) {
				User user = SystemUtils.getCurUser();
				knowledgeService.addBussinessKnowledge(knowledgeID, knowledgeTitle,bk,status,listknowledgeTags, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/editBussinessKnowledge")
    @ResponseBody
    public JSONObject editBussinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String knowledgeID = param.getString("knowledgeID");
			String knowledgeTitle = param.getString("knowledgeTitle").trim();
			String bk = param.getString("knowledgeText").trim();
			int status = param.getInteger("status");
			List<String> listknowledgeTags = param.getList("knowledgeTags", String.class);
			if (!"".equals(bk) && knowledgeID != null) {
				User user = SystemUtils.getCurUser();
				knowledgeService.editBussinessKnowledge(knowledgeID,knowledgeTitle, bk,status,listknowledgeTags, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/delBussinessKnowledge")
    @ResponseBody
    public JSONObject delBussinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String knowledgeID = param.getString("knowledgeID");
			if (knowledgeID != null) {
				User user = SystemUtils.getCurUser();
				knowledgeService.delBussinessKnowledge(knowledgeID, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/getBussinessKnowledge")
    @ResponseBody
    public JSONObject getBussinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Map<String, KnowledgeEntity> bussinessKnowledges = knowledgeService.getBussinessKnowledge(user.getDomainId());
			ret.put("success", true);
			ret.put("data", bussinessKnowledges);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/admin/getbussinessknowledgemarkdown")
	@ResponseBody
	public JSONObject getBussinessKnowledgeMarkdown(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String bussinessKnowledgeMarkdown = adminService.getBussinessKnowledgeMarkdown(user.getDomainId());
			ret.put("success", true);
			ret.put("data", bussinessKnowledgeMarkdown);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/saveQuestionSpliterExample")
	@ResponseBody
	public JSONObject saveQuestionSpliterExample(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			boolean inheritDefault = Boolean.TRUE.equals(param.getBoolean("inheritDefault"));
			String content = inheritDefault ? null : getRequiredExampleContent(param);
			ret.put("success", adminService.saveQuestionSpliterExample(content, inheritDefault, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@GetMapping("/admin/getQuestionSpliterExample")
	@ResponseBody
	public JSONObject getQuestionSpliterExample() {
		User user = SystemUtils.getCurUser();
		JSONObject ret = new JSONObject();
		ret.put("data", adminService.getQuestionSpliterExample(user.getDomainId()));
		ret.put("success", true);
		return ret;
	}
	
	@PostMapping("/admin/saveDslCookerExample")
	@ResponseBody
	public JSONObject saveDslCookerExample(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			boolean inheritDefault = Boolean.TRUE.equals(param.getBoolean("inheritDefault"));
			String content = inheritDefault ? null : getRequiredExampleContent(param);
			ret.put("success", adminService.saveDslCookerExample(content, inheritDefault, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@GetMapping("/admin/getDslCookerExample")
	@ResponseBody
	public JSONObject getDslCookerExample() {
		User user = SystemUtils.getCurUser();
		JSONObject ret = new JSONObject();
		ret.put("data", adminService.getDslCookerExample(user.getDomainId()));
		ret.put("success", true);
		return ret;
	}

	@PostMapping("/admin/saveAbcProgrammerExample")
	@ResponseBody
	public JSONObject saveAbcProgrammerExample(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			boolean inheritDefault = Boolean.TRUE.equals(param.getBoolean("inheritDefault"));
			String content = inheritDefault ? null : getRequiredExampleContent(param);
			ret.put("success", adminService.saveAbcProgrammerExample(content, inheritDefault, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@GetMapping("/admin/getAbcProgrammerExample")
	@ResponseBody
	public JSONObject getAbcProgrammerExample() {
		User user = SystemUtils.getCurUser();
		JSONObject ret = new JSONObject();
		ret.put("data", adminService.getAbcProgrammerExample(user.getDomainId()));
		ret.put("success", true);
		return ret;
	}

	private String getRequiredExampleContent(JSONObject param) {
		if (!param.containsKey("content") || param.get("content") == null) {
			throw new IllegalArgumentException("content is required when inheritDefault is false");
		}
		return param.getString("content");
	}
	
	@GetMapping("/admin/getSchema")
	@ResponseBody
	public JSONObject getSchema() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			ret.put("success", true);
			ret.put("data", rule);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/setSchema")
	@ResponseBody
	public JSONObject setSchema(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			adminService.setPrettyJSONRule(param, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
