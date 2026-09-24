package io.ontomato.dataengine.service;

import java.io.File;
import java.io.InputStream;

import io.ontomato.dataengine.bean.VectorResource;

public interface VectorResourceService {

	public void rebuildIndex(String className, String attrName, String domainId);
	
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId);
	
	public File getFile(String indexName, String fileName);
	
}
