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
		String originalText = vectorResource.getContent();
		requireClassDef(vectorResource.getClassName(), jsonRuleDao.query(domainId));

		VectorResource saved = vectorResourceDao.insert(vectorResource, is, suffix, domainId);
		try {
			updateObjectVectorAttr(saved.getClassName(), saved.getAttrName(), saved.getObjectId(), domainId, current -> {
				JSONArray updated = new JSONArray();
				boolean exists = false;
				if (current != null) {
					for (int i = 0; i < current.size(); i++) {
						JSONObject item = current.getJSONObject(i);
						if (saved.getPath().equals(item.getString("path"))) {
							exists = true;
						}
						updated.add(item);
					}
				}
				if (!exists) {
					JSONObject newItem = new JSONObject();
					newItem.put("path", saved.getPath());
					newItem.put("text", originalText);
					updated.add(newItem);
				}
				return updated;
			});
		} catch (Exception e) {
			try {
				vectorResourceDao.delete(saved.getClassName(), saved.getAttrName(), saved.getObjectId(), saved.getPath(), domainId);
			} catch (Exception rollbackEx) {
				e.addSuppressed(rollbackEx);
			}
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("attach vector resource to object failed: " + e.getMessage(), e);
		}
		return saved;
	}

	@Override
	public void deleteAndDetach(String className, String attrName, String objectId, String path, String domainId) {
		vectorResourceDao.delete(className, attrName, objectId, path, domainId);
		try {
			updateObjectVectorAttr(className, attrName, objectId, domainId, current -> {
				JSONArray updated = new JSONArray();
				if (current != null) {
					for (int i = 0; i < current.size(); i++) {
						JSONObject item = current.getJSONObject(i);
						if (!path.equals(item.getString("path"))) {
							updated.add(item);
						}
					}
				}
				return updated;
			});
		} catch (RuntimeException re) {
			throw re;
		} catch (Exception e) {
			throw new RuntimeException("detach vector resource from object failed: " + e.getMessage(), e);
		}
	}

	private Map<String, Object> requireClassDef(String className, Map<String, Object> jsonRule) {
		List<Map<String, Object>> classDefs = jsonRule != null ? (List<Map<String, Object>>) jsonRule.get("classDef") : null;
		if (classDefs != null) {
			for (Map<String, Object> cd : classDefs) {
				if (className.equals(cd.get("className"))) {
					return cd;
				}
			}
		}
		throw new IllegalArgumentException("classDef not found for className: " + className);
	}

	private void updateObjectVectorAttr(String className, String attrName, String objectId, String domainId,
			java.util.function.UnaryOperator<JSONArray> attrUpdater) throws Exception {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		Map<String, Object> classDef = requireClassDef(className, jsonRule);

		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);

		JSONArray current = adapter.queryVectorAttr(classDef, attrName, objectId);
		JSONArray updated = attrUpdater.apply(current);

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
