package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface AdminService {

	public void setDataSetDesc(String dataSetDesc, User user);
	
	public void addRelationship(String relationName, String fromClassName, String toClassName, String relationDesc, String fromField, String toField, String lang, User user) throws Exception;
	
	public void delRelationship(String relationName, User user);

	public void setRelationshipDesc(String relationship, String desc, User user);
	
	public void addClass(String className, String primaryKeyName, String showName, String classDesc, boolean classToCard, boolean instanceToCard, boolean inStarChart, String lang, User user) throws Exception;
	
	public void delClass(String className, User user);
	
	public void setClassDesc(String className, String desc, User user);
	
	public void setClassShowName(String className, String showName, User user);
	
	public void setClassInStarChart(String className, boolean inStarChart, User user);
	
	public void addClassAttr(String className, String attrName, String showName, String attrDesc, String type, boolean bizzKey, boolean enable, String lang, User user) throws Exception;
	
	public void delClassAttr(String className, String attrName, String lang, User user) throws Exception;
	
	public void setClassAttrDesc(String className, String attr, String desc, String enable, String lang, User user) throws Exception;
	
	public void setClassAttrShowName(String className, String attr, String showName, User user);
	
	public void setClassAttrTimeFormat(String className, String attr, String format, User user);
	
	public void setClassAttrShouldReturn(String className, String attr, boolean shouldReturn, User user);

	public void setClassAttrPermissionField(String className, String attr, boolean permissionField, User user);
	
	public void setClassAttrPrimaryKey(String className, String attr, String lang, User user) throws Exception;
	
	public void addBucketIndicator(String className, String attrName, String indicatorName, String indicatorDesc, String indicatorUnit, String lang, User user) throws Exception;
	
	public void delBucketIndicator(String className, String attrName, String indicatorName, User user);
	
	public void setBucketIndicatorDesc(String className, String attr, String indicator, String desc, User user);
	
	public void setBucketIndicatorUnit(String className, String attr, String indicator, String unit, User user);
	
	public Map<String, Object> getJSONRule(String domainId);

	public Map<String, String> getSchemaMarkdown(List<String> classNames, String domainId);
	
	public Map<String, String> getSchemaMarkdownV2(List<String> classNames, String domainId);
	
	public String getSchemaByClassName(List<String> classNames, String domainId);
	
	public String getRelationshipByClassNames(List<String> classNames, String domainId);
	
	public String queryDistinctAttrValue(String className, String attrName, String like, int limit, UserDataPermission permission, String domainId);

	public String getBussinessKnowledgeMarkdown(String domainId);
	
	public JSONObject getPrettyJSONRule(String domainId);
	
	public void setPrettyJSONRule(JSONObject prettyJsonRule, String domainId);
	
	public boolean saveQuestionSpliterExample(String content, boolean inheritDefault, String domainId);
	
	public String getQuestionSpliterExample(String domainId);
	
	public boolean saveDslCookerExample(String content, boolean inheritDefault, String domainId);
	
	public String getDslCookerExample(String domainId);

	public boolean saveAbcProgrammerExample(String content, boolean inheritDefault, String domainId);

	public String getAbcProgrammerExample(String domainId);
	
}
