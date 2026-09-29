package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.VectorResourceService;
import io.ontomato.dataengine.util.DslUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class VectorResourceServiceImpl implements VectorResourceService {
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;

	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private JSONRuleDao jsonRuleDao;

	@Override
	public void rebuildIndex(String className, String attrName, String domainId) {
		vectorResourceDao.rebuildIndex(className, attrName, domainId);
	}

	@Override
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		return vectorResourceDao.insert(vectorResource, is, suffix, domainId);
	}

	@Override
	public VectorResource saveAndAttach(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		// Preserve the original text before insert overwrites content with the cleaned brief.
		String originalText = vectorResource.getContent();
		VectorResource saved = vectorResourceDao.insert(vectorResource, is, suffix, domainId);
		if (saved == null) {
			return null;
		}
		try {
			attachToObject(saved, originalText, domainId);
		} catch (Exception e) {
			// The vector resource is already persisted; an attach failure should not roll it back silently.
			log.error("attach vector resource to object failed: " + e.getMessage(), e);
		}
		return saved;
	}

	private void attachToObject(VectorResource saved, String originalText, String domainId) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (saved.getClassName().equals(cd.get("className"))) {
				classDef = cd;
				break;
			}
		}
		if (classDef == null) {
			log.warn("classDef not found for className: {}", saved.getClassName());
			return;
		}

		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);

		// Read the object's current vector attribute.
		JSONArray current = adapter.queryVectorAttr(classDef, saved.getAttrName(), saved.getObjectId());

		// Deduplicate by path, then append the new entry.
		JSONArray updated = new JSONArray();
		boolean exists = false;
		for (int i = 0; i < current.size(); i++) {
			JSONObject item = current.getJSONObject(i);
			if (saved.getPath().equals(item.getString("path"))) {
				exists = true;
			}
			updated.add(item);
		}
		if (!exists) {
			JSONObject newItem = new JSONObject();
			newItem.put("path", saved.getPath());
			newItem.put("text", originalText);
			updated.add(newItem);
		}

		// Write back the updated vector attribute.
		String pkField = adapter.useM3() ? "id" : DslUtil.getPrimaryKey(classDef);
		JSONObject setValues = new JSONObject();
		setValues.put(saved.getAttrName(), updated);
		JSONObject where = new JSONObject();
		where.put("field", pkField);
		where.put("operator", "=");
		where.put("value", saved.getObjectId());
		adapter.updateObjects(null, classDef, setValues, where);
	}

	@Override
	public void deleteAndDetach(String className, String attrName, String objectId, String path, String domainId) {
		vectorResourceDao.delete(className, attrName, objectId, path, domainId);
		try {
			detachFromObject(className, attrName, objectId, path, domainId);
		} catch (Exception e) {
			// The vector record/file is already removed; a detach failure should not surface as a hard error.
			log.error("detach vector resource from object failed: " + e.getMessage(), e);
		}
	}

	private void detachFromObject(String className, String attrName, String objectId, String path, String domainId) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (className.equals(cd.get("className"))) {
				classDef = cd;
				break;
			}
		}
		if (classDef == null) {
			log.warn("classDef not found for className: {}", className);
			return;
		}

		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);

		JSONArray current = adapter.queryVectorAttr(classDef, attrName, objectId);

		JSONArray updated = new JSONArray();
		for (int i = 0; i < current.size(); i++) {
			JSONObject item = current.getJSONObject(i);
			if (!path.equals(item.getString("path"))) {
				updated.add(item);
			}
		}

		String pkField = adapter.useM3() ? "id" : DslUtil.getPrimaryKey(classDef);
		JSONObject setValues = new JSONObject();
		setValues.put(attrName, updated);
		JSONObject where = new JSONObject();
		where.put("field", pkField);
		where.put("operator", "=");
		where.put("value", objectId);
		adapter.updateObjects(null, classDef, setValues, where);
	}

	@Override
	public File getFile(String indexName, String fileName) {
		return vectorResourceDao.getFile(indexName, fileName);
	}

}
