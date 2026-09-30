package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.util.HttpRequestUtil.M3Mode;

public interface DataAdapter {

	public String executeDsl(String queryJson, String sessionId, M3Mode m3Mode, List<String> generatedMqls) throws Exception;
	
	public String getSampleDataFileName(String sampleDataDirName, String className);
	
	public String querySampleDataByClassName(String className, List<String> attrs);
	
	public boolean useM3();
	
	public void validateClassNameFormat(String className) throws Exception;
	
	public void createNamespace(String namespace);
	
	public void truncateNamespace(String namespace);
	
	public void dropNamespace(String namespace);
	
	public void createClass(String namespace, Map<String, Object> classDef);
	
	public void createEdgeType(String namespace, String edgeName);
	
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception;
	
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where) throws Exception;
	
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception;
	
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId) throws Exception;
	
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId) throws Exception;
	
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception;
	
	/**
	 * Query the current value of a single object's vector attribute.
	 *
	 * <p>A vector attribute is stored as a text column holding the JSON array string
	 * {@code [{"path":"...","text":"..."},...]}. This method returns that array parsed
	 * into a {@link JSONArray} (empty array when the attribute is null/blank).
	 * If the object does not exist, an {@link IllegalArgumentException} is thrown.</p>
	 *
	 * @param classDef the class definition (used to resolve the full class/table name and primary key)
	 * @param attrName the vector attribute name
	 * @param objectId the object's stored id value (M3 uses the {@code class:id} prefixed form,
	 *                 relational adapters use the plain primary-key value) — no prefix handling is done here
	 * @return the current vector attribute value as a JSON array
	 * @throws IllegalArgumentException if the object does not exist
	 */
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception;

	/**
	 * Resolve the sandbox-scoped class (table) name for the given plain class name.
	 *
	 * <p>M3 adapters strip the namespace segment from {@code /namespace/ClassName} and return
	 * {@code /sandboxId/ClassName}; relational adapters simply prefix the plain class name
	 * ({@code sandboxId + className}). This mirrors exactly how each adapter names its business
	 * table inside a sandbox, so vector-table names stay aligned with reads.</p>
	 */
	public String sandboxClassName(String sandboxId, String className);

	/**
	 * Resolve the sandbox-scoped object id for the given plain object id.
	 *
	 * <p>M3 adapters prefix the id ({@code sandboxId + objectId}), matching the id value the M3
	 * store actually holds for a sandbox object; relational adapters leave the plain primary-key
	 * value unchanged (they never prefix the id column).</p>
	 */
	public String sandboxObjectId(String sandboxId, String objectId);

}
