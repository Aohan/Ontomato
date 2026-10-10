package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
public class HttpRequestUtil {

    // Returns [execution result without permission, row permission execution result]; each item contains the query data or failure fact and the original DSL
    public static DslExecutionResult[] executeDsl(
    		DataRagConfig dataRagConfig, 
    		DataAdapter adapter, 
    		String queryJson, 
    		String sessionId, 
    		boolean onlySearchPermissionData,
    		Map<String, Object> jsonRule,
    		VectorResourceDao vectorResourceDao, 
    		UserDataPermission permission,
    		DslExecutionMode mode,
    		String domainId) {
    	
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		queryJson = DslUtil.normalizeClassNames(queryJson, classDefs);
		List<JSONObject> dsls = JSON.parseArray(queryJson, JSONObject.class);
		JSONObject originDsl = dsls.get(0);

		Object[] dsl_selectAsFilePathsMap_vectorResourceAsSet;
		try {
			dsl_selectAsFilePathsMap_vectorResourceAsSet = DslUtil.splitToVector(queryJson, classDefs, vectorResourceDao, domainId);
		} catch (Exception e) {
			log.error("Failed to process vector: " + e.getMessage(), e);
			DslExecutionResult failResult = DslExecutionResult.failure(new JSONObject(), e);
			failResult.data().put("dsl", originDsl);
			return new DslExecutionResult[] {failResult, failResult.copy()};
		}
		JSONObject vectorDsl = (JSONObject)dsl_selectAsFilePathsMap_vectorResourceAsSet[0];
		Map<String, List<String>> selectAsFilePathsMap = (Map<String, List<String>>)dsl_selectAsFilePathsMap_vectorResourceAsSet[1];
		Set<String> vectorResourceAsSet = (Set<String>)dsl_selectAsFilePathsMap_vectorResourceAsSet[2];

		Object[] rowPermissionDslResult = DslPermissionUtil.addRowPermission("[" + JSON.toJSONString(vectorDsl, Feature.WriteMapNullValue) + "]", classDefs, permission);
		JSONObject rowPermissionDsl = rowPermissionDslResult[0] == null ? null : (JSONObject)rowPermissionDslResult[0];
		boolean addPermission = rowPermissionDslResult[1] == null ? false : (boolean)rowPermissionDslResult[1];
        
        DslExecutionResult rowPermissionResult = executeOne(dataRagConfig, adapter, rowPermissionDsl, sessionId, selectAsFilePathsMap, vectorResourceAsSet, mode);
        DslExecutionResult result = DslExecutionResult.success(new JSONObject());
        if (!onlySearchPermissionData) { // when data without permission is needed
        	if (addPermission) { // the DSL after adding row permission differs from the DSL without permission
				result = executeOne(dataRagConfig, adapter, originDsl, sessionId, selectAsFilePathsMap, vectorResourceAsSet, mode);
        	} else { // no difference
				result = rowPermissionResult.copy();
        	}
        }
        result.data().put("dsl", originDsl);
        rowPermissionResult.data().put("dsl", originDsl);
		return new DslExecutionResult[] {result, rowPermissionResult};
    }
    
    public static List<String> getNodeIds(
            DataAdapter adapter,
            String queryJson,
            Map<String, Object> jsonRule,
            VectorResourceDao vectorResourceDao,
            UserDataPermission permission,
            String domainId) {
    	
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		queryJson = DslUtil.normalizeClassNames(queryJson, classDefs);

		Object[] dsl_selectAsFilePathsMap_vectorResourceAsSet;
		try {
			dsl_selectAsFilePathsMap_vectorResourceAsSet = DslUtil.splitToVector(queryJson, classDefs, vectorResourceDao, domainId);
		} catch (RuntimeException e) {
			throw e;
		} catch (Exception e) {
			throw new RuntimeException("Failed to process vector in getNodeIds: " + e.getMessage(), e);
		}
		JSONObject vectorDsl = (JSONObject)dsl_selectAsFilePathsMap_vectorResourceAsSet[0];

		Object[] rowPermissionDslResult = DslPermissionUtil.addRowPermission("[" + JSON.toJSONString(vectorDsl, Feature.WriteMapNullValue) + "]", classDefs, permission);
		JSONObject rowPermissionDsl = rowPermissionDslResult[0] == null ? null : (JSONObject)rowPermissionDslResult[0];
    	
    	Set<String> nodeIds = new HashSet<String>();
    	String nodeDslStr = DslUtil.fromQuestionDslToNodeDsl("[" + JSON.toJSONString(rowPermissionDsl, Feature.WriteMapNullValue) + "]");
        try {
			String nodeResp = adapter.executeDsl(nodeDslStr, null, DslExecutionMode.OPTIMIZED, new ArrayList<String>());
        	for (Map map : JSON.parseArray(nodeResp, Map.class)) {
        		List answer = (List)map.get("answer");
        		for (Object obj : answer) {
        			Map m = (Map)obj;
        			for (Object k : m.keySet()) {
        				String key = (String)k;
        				if (key.endsWith("_id")) {
        					nodeIds.add((String)m.get(k));
        				}
        			}
        		}
        	}
        } catch (Exception e) {}
        List<String> nodeList = new ArrayList<String>();
        if (nodeIds.size() > 100) {
        	for (String nodeId : nodeIds) {
        		nodeList.add(nodeId);
        		if (nodeList.size() == 100) {
        			break;
        		}
        	}
        } else {
        	nodeList.addAll(nodeIds);
        }
        return nodeList;
    }
    
    private static DslExecutionResult executeOne(
    		DataRagConfig dataRagConfig, 
    		DataAdapter adapter, 
    		JSONObject dsl, 
    		String sessionId, 
    		Map<String, List<String>> selectAsFilePathsMap, 
    		Set<String> vectorResourceAsSet,
    		DslExecutionMode mode) {
    	
    	JSONObject dataMap = new JSONObject();
		List<String> generatedMqls = new ArrayList<String>();
    	
		try {
			String JsonData = adapter.executeDsl("[" + JSON.toJSONString(dsl, Feature.WriteMapNullValue) + "]", sessionId, mode, generatedMqls);
			if (JsonData != null) {
        	log.info("Data source returned data, sessionId-{}>>>:\n{}",sessionId,JsonData);
            LogHelper.dataSourceReturnData(JsonData);
            
            List<Map> listData = JSON.parseArray(JsonData, Map.class);

            //4. Remove the _.path field from the data returned by M3; if selectAsFilePathsMap is not empty, filter vector conditions and also process files into URLs
            if(listData!=null&& listData.size()>0){
                for(Map mapData : listData){
                    List<Map> listAnswer = (List<Map>)mapData.get("answer");
                    if(listAnswer!=null && listAnswer.size()>0){
                        for(Map mapAnswer : listAnswer){
                        	// Remove the _.path field from the data returned by M3
                            if(mapAnswer.containsKey("_.path")){
                                mapAnswer.remove("_.path");
                            }
                            // If selectAsFilePathsMap is not empty, filter vector conditions and also process files into URLs
                            for (String as : vectorResourceAsSet) {
                            	if (selectAsFilePathsMap != null && selectAsFilePathsMap.get(as) != null) {
                            		List<String> paths = selectAsFilePathsMap.get(as);
                            		try {
                                        JSONArray array = DslUtil.parseVectorAttr(mapAnswer.get(as));
                            			JSONArray newArray = new JSONArray();
                            			for (int i = 0; i < array.size(); i++) {
                                            JSONObject row = array.getJSONObject(i);
                            				String path = row.getString("path");
                            				if (paths.contains(path)) {
                            					row.put("path", dataRagConfig.getCardBaseUrl() + "/vectorResource/resource/" + path);
                            					newArray.add(row);
                            				}
                            			}
                            			mapAnswer.put(as, newArray);
                            		} catch (Exception e) {}
                            	} else {
                            		try {
                                        JSONArray array = DslUtil.parseVectorAttr(mapAnswer.get(as));
                            			JSONArray newArray = new JSONArray();
                            			for (int i = 0; i < array.size(); i++) {
                                            JSONObject row = array.getJSONObject(i);
                            				String path = row.getString("path");
                            				row.put("path", dataRagConfig.getCardBaseUrl() + "/vectorResource/resource/" + path);
                            				newArray.add(row);
                            			}
                            			mapAnswer.put(as, newArray);
                            		} catch (Exception e) {}
                            	}
                            }
                        }
                    }
                }
//                // Handle flattening and deduplication of the doctor database
//                for (Map mapData : listData) {
//                    List<Map> listAnswer = (List<Map>)mapData.get("answer");
//                    List<Map> noRepeatListAnswer = new ArrayList<Map>();
//                    Set<String> datumStrValueSet = new HashSet<String>();
//                    if (listAnswer != null && listAnswer.size() > 0) {
//                        for (Map mapAnswer : listAnswer) {
//                        	JSONObject obj = JSONObject.from(mapAnswer);
//                        	String datumStrValue = obj.toString();
//                        	if (!datumStrValueSet.contains(datumStrValue)) {
//                        		noRepeatListAnswer.add(mapAnswer);
//                        		datumStrValueSet.add(datumStrValue);
//                        	}
//                        }
//                    }
//                    mapData.put("answer", noRepeatListAnswer);
//                }
                for (Map mapData : listData) {
                	if (mapData.get("answer") == null) {
                		mapData.put("answer", new ArrayList<Map>());
                	}
                }
            }
            dataMap.put("data", listData);
            
            // Return the involved attribute names
            try {
            	dataMap.put("classAttrs", DslUtil.getAttrNameByDsl("[" + JSON.toJSONString(dsl, Feature.WriteMapNullValue) + "]"));
            } catch (Exception e) {
            	log.error(e.getMessage(), e);
            }
			}

			return DslExecutionResult.success(dataMap);
		} catch (Exception e) {
			log.error("[" + sessionId + "] Failed to query the database", e);
			return failedDslExecution(e, generatedMqls);
		}
    }

    static DslExecutionResult failedDslExecution(Exception cause, List<String> generatedMqls) {
		JSONObject dataMap = new JSONObject();
		if (!generatedMqls.isEmpty()) {
			JSONObject partialResult = new JSONObject();
			partialResult.put("mqls", new ArrayList<String>(generatedMqls));
			JSONArray partialResults = new JSONArray();
			partialResults.add(partialResult);
			dataMap.put("data", partialResults);
		}
		return DslExecutionResult.failure(dataMap, cause);
	}

    public static String getSampleDataByClassName(DataAdapter adapter, String className, List<String> attrs) {
    	String sampleDataDirName = "sampleData";
    	String sampleDataFileName = adapter.getSampleDataFileName(sampleDataDirName, className);
    	String sampleDataContent = getSampleDataByClassNameFromCache(sampleDataFileName);
    	
    	if (sampleDataContent == null) { // no sample data for this class in the cache
    		sampleDataContent = adapter.querySampleDataByClassName(className, attrs);
            
            // Write to the cache file
            FileOutputStream fos = null;
            try {
            	File file = new File(sampleDataFileName);
            	file.getParentFile().mkdirs();
            	fos = new FileOutputStream(file);
            	fos.write(sampleDataContent.getBytes("utf-8"));
            } catch (Exception e) {
            	log.error(e.getMessage(), e);
            } finally {
            	if (fos != null) {
            		try {
            			fos.close();
            		} catch (Exception e) {
            			log.error(e.getMessage(), e);
            		}
            	}
            }
    	}
    	
    	return sampleDataContent;
    }
    
    private static String getSampleDataByClassNameFromCache(String sampleDataFileName) {
    	FileInputStream fis = null;
		try {
			File file = new File(sampleDataFileName);
			if (file.exists() && file.lastModified() > System.currentTimeMillis() - 24 * 60 * 60 * 1000L) {
				fis = new FileInputStream(file);
				return new String(fis.readAllBytes(), "utf-8");
			}
		} catch (Exception e) {
		} finally {
			if (fis != null) {
				try {
					fis.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return null;
    }

    public static String postProductionEnv(String url, Map<String, String> headers, Object param) throws Exception {
    	RestTemplate restTemplate = new RestTemplate();

        HttpHeaders requestHeaders = new HttpHeaders();
        if (headers != null) {
        	for (String key : headers.keySet()) {
        		requestHeaders.add(key, headers.get(key));
        	}
        }
        
        HttpEntity<String> requestEntity = new HttpEntity<>(param == null ? "" : JSON.toJSONString(param, Feature.WriteMapNullValue), requestHeaders);
        ResponseEntity<String> responseEntity =  restTemplate.postForEntity(url, requestEntity, String.class);
        String result = responseEntity.getBody();
        return result;
    }
    
    public static String getProductionEnv(String url, Map<String, String> headers) throws Exception {
    	RestTemplate restTemplate = new RestTemplate();

        HttpHeaders requestHeaders = new HttpHeaders();
        if (headers != null) {
        	for (String key : headers.keySet()) {
        		requestHeaders.add(key, headers.get(key));
        	}
        }
        
        HttpEntity<String> requestEntity = new HttpEntity<>(requestHeaders);
        ResponseEntity<String> responseEntity = restTemplate.exchange(url, HttpMethod.GET, requestEntity, String.class);
        String result = responseEntity.getBody();
        return result;
    }
    
}
