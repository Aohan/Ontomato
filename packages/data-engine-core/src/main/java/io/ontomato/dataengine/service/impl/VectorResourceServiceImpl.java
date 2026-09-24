package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.InputStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.VectorResourceService;

@Service
public class VectorResourceServiceImpl implements VectorResourceService {
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Override
	public void rebuildIndex(String className, String attrName, String domainId) {
		vectorResourceDao.rebuildIndex(className, attrName, domainId);
	}

	@Override
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		return vectorResourceDao.insert(vectorResource, is, suffix, domainId);
	}
	
	@Override
	public File getFile(String indexName, String fileName) {
		return vectorResourceDao.getFile(indexName, fileName);
	}

}
