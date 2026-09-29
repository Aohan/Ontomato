package io.ontomato.dataengine.service;

import java.io.File;
import java.io.InputStream;

import io.ontomato.dataengine.bean.VectorResource;

public interface VectorResourceService {

	public void rebuildIndex(String className, String attrName, String domainId);
	
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId);
	
	/**
	 * Save the vector resource and attach it to the business object's vector attribute.
	 *
	 * <p>In addition to {@link #save} (write the file + vector table), this reads the object's
	 * current vector attribute, appends a new {@code {"path":...,"text":...}} entry (deduplicated
	 * by path) and writes it back via {@code updateObjects}.</p>
	 */
	public VectorResource saveAndAttach(VectorResource vectorResource, InputStream is, String suffix, String domainId);

	/**
	 * Delete a vector resource (by object id + path) and detach it from the business object's vector attribute.
	 *
	 * <p>Removes the vector table record and file, then drops the matching {@code {"path":...,"text":...}}
	 * entry from the object's vector attribute and writes it back.</p>
	 */
	public void deleteAndDetach(String className, String attrName, String objectId, String path, String domainId);

	public File getFile(String indexName, String fileName);
	
}
