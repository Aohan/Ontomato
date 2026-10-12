package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class MysqlAdapter implements DataAdapter {
	
	private DataAdapterConnection connection;
	private Map<String, Object> jsonRule;
	
	public MysqlAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	@Override
	public Connection openConnection() throws SQLException {
		return DriverManager.getConnection(connection.getUrl(), connection.getUser(), connection.getPassword());
	}

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception {
		log.info("[" + sessionId + "] DSL for querying mysql: " + queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		String sql = toSql(dsls.getJSONObject(0), jsonRule);
		generatedMqls.add(sql);
		log.info("[" + sessionId + "] converted mysql sql: " + sql);
		JSONArray data = executeSql(sql);
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", data);
		answer.put("mqls", generatedMqls);
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}
	
	private String toSql(JSONObject dsl, Map<String, Object> jsonRule) throws Exception {
		try {
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Map<String, String>> classAttrTypeMap = new HashMap<String, Map<String, String>>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> attrTypeMap = new HashMap<String, String>();
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					attrTypeMap.put((String)attrDef.get("name"), (String)attrDef.get("type"));
				}
				classAttrTypeMap.put((String)classDef.get("className"), attrTypeMap);
			}
			Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
			
			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);
			// Generate the where clause of the sub-query
			JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
			String subSelectWhere = "";
			Map<Integer, String[]> idxMap = new HashMap<Integer, String[]>();
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				String className = object.getString("class");
				String alias = object.getString("variable");
				idxMap.put(object.getInteger("idx"), new String[] {className, alias});
				Map<String, String> attrTypeMap = classAttrTypeMap.get(className);
				String objWhere = "";
				if (object.getJSONObject("conditions") != null) {
					JSONObject conditions = object.getJSONObject("conditions");
					if (conditions.getJSONObject("properties") != null) {
						JSONObject properties = conditions.getJSONObject("properties");
						// [cond, and_or_closing bracket]
						List<Object[]> queue = new ArrayList<Object[]>();
						queue.add(new Object[] {properties, null, null});
						while (queue.size() > 0) {
							Object[] objs = queue.removeFirst();
							JSONObject cond = objs[0] == null ? null : (JSONObject)objs[0];
							String and_or_end = objs[1] == null ? null : (String)objs[1];
							if (cond == null && and_or_end != null) { // and\or\closing bracket
								objWhere += and_or_end;
							} else if (cond.getJSONArray("and") != null && cond.getJSONArray("and").size() > 0) {
								objWhere += "(";
								List<Object[]> newQueue = new ArrayList<Object[]>();
								JSONArray ands = cond.getJSONArray("and");
								for (int j = 0; j < ands.size(); j++) {
									JSONObject and = ands.getJSONObject(j);
									newQueue.add(new Object[] {and, null});
									if (j < ands.size() - 1) {
										newQueue.add(new Object[] {null, " and "});
									}
								}
								newQueue.add(new Object[] {null, ")"});
								newQueue.addAll(queue);
								queue = newQueue;
							} else if (cond.getJSONArray("or") != null && cond.getJSONArray("or").size() > 0) {
								objWhere += "(";
								List<Object[]> newQueue = new ArrayList<Object[]>();
								JSONArray ors = cond.getJSONArray("or");
								for (int j = 0; j < ors.size(); j++) {
									JSONObject or = ors.getJSONObject(j);
									newQueue.add(new Object[] {or, null});
									if (j < ors.size() - 1) {
										newQueue.add(new Object[] {null, " or "});
									}
								}
								newQueue.add(new Object[] {null, ")"});
								newQueue.addAll(queue);
								queue = newQueue;
							} else {
								String attr = cond.getString("field");
								String type = attrTypeMap.get(attr);
								String sqlCond = null;
								if ("=".equals(cond.getString("operator")) || "!=".equals(cond.getString("operator"))) {
									if ("varchar".equals(type)) {
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " '" + cond.getString("value").replace("'", "''") + "'";
									} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " " + cond.get("value");
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " FROM_UNIXTIME(" + cond.getLong("value") + ")";
									}
								} else if ("like".equals(cond.getString("operator")) || "not like".equals(cond.getString("operator"))) {
									if ("varchar".equals(type)) {
										String value = cond.getString("value").replace("'", "''").trim();
										if (!value.startsWith("%") && !value.endsWith("%")) {
											value = "%" + value + "%";
										}
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " '" + value + "'";
									}
								} else if (">".equals(cond.getString("operator")) || ">=".equals(cond.getString("operator")) || "<=".equals(cond.getString("operator")) || "<".equals(cond.getString("operator"))) {
									if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " " + cond.get("value");
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " FROM_UNIXTIME(" + cond.getLong("value") + ")";
									}
								} else if ("between".equals(cond.getString("operator"))) {
									JSONArray value = cond.getJSONArray("value");
									if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "(`" + alias + "`." + attr + " >= " + value.get(0) + " and `" + alias + "`." + attr + " <= " + value.get(1) + ")";
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "(`" + alias + "`." + attr + " >= FROM_UNIXTIME(" + value.getLong(0) + ") and `" + alias + "`." + attr + " <= FROM_UNIXTIME(" + value.getLong(1) + "))";
									}
								} else if ("in".equals(cond.getString("operator"))) {
									JSONArray value = cond.getJSONArray("value");
									if ("varchar".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += "'" + value.getString(j).replace("'", "''") + "',";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " " + in;
									} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += value.get(j) + ",";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " " + in;
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += "FROM_UNIXTIME(" + value.getLong(j) + "),";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " " + in;
									}
								} else if ("is".equals(cond.getString("operator")) || "is not".equals(cond.getString("operator"))) {
									sqlCond = "`" + alias + "`." + attr + " " + cond.getString("operator") + " null";
								}
								if (sqlCond != null) {
									objWhere += sqlCond;
								}
							}
						}
					}
				}
				if (!"".equals(objWhere)) {
					subSelectWhere += objWhere + " and ";
				}
			}
			if (!"".equals(subSelectWhere)) {
				subSelectWhere = subSelectWhere.substring(0, subSelectWhere.length() - 5);
			}
			// Generate the from clause of the sub-query
			String subSelectFrom = "";
			JSONArray relationships = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("relationship");
			if (relationships != null && relationships.size() > 0) {
				Set<Integer> inJoinIdxs = new HashSet<Integer>();
				Set<Integer> inJoinRelIndexes = new HashSet<Integer>();
				List<String> innerJoinSqls = new ArrayList<String>();
				List<Set<Integer>> innerJoinClassesList = new ArrayList<Set<Integer>>();
				while (true) {
					int inJoinRelCount = inJoinRelIndexes.size();
					for (int i = 0; i < relationships.size(); i++) {
						if (!inJoinRelIndexes.contains(i)) {
							JSONObject relationship = relationships.getJSONObject(i);
							Integer fromIdx = relationship.getInteger("from");
							Integer toIdx = relationship.getInteger("to");
							String[] fromClassAlias = idxMap.get(fromIdx);
							String[] toClassAlias = idxMap.get(toIdx);
							String relationshipName = relationship.getJSONArray("type").getString(0).trim();
							Map<String, Object> relationDef = (Map<String, Object>)relationship_rule.get(relationshipName);
							String fromField = (String)relationDef.get("fromField");
							String toField = (String)relationDef.get("toField");
							if (inJoinIdxs.size() == 0) {
								innerJoinSqls.add(fromClassAlias[0] + " as `" + fromClassAlias[1] + "`"
										+ " inner join " + toClassAlias[0] + " as `" + toClassAlias[1] + "`"
										+ " on `" + fromClassAlias[1] + "`." + fromField + " = `" + toClassAlias[1] + "`." + toField);
								inJoinIdxs.add(fromIdx);
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<Integer>();
								innerJoinClasses.addAll(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && !inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + toClassAlias[0] + " as `" + toClassAlias[1] + "`"
										+ " on `" + fromClassAlias[1] + "`." + fromField + " = `" + toClassAlias[1] + "`." + toField);
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<Integer>();
								innerJoinClasses.addAll(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (!inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + fromClassAlias[0] + " as `" + fromClassAlias[1]  + "`"
										+ " on `" + fromClassAlias[1] + "`." + fromField + " = `" + toClassAlias[1] + "`." + toField);
								inJoinIdxs.add(fromIdx);
								Set<Integer> innerJoinClasses = new HashSet<Integer>();
								innerJoinClasses.addAll(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								Integer innerJoinSqlIndex = null;
								for (int j = 0; j < innerJoinClassesList.size(); j++) {
									Set<Integer> innerJoinClasses = innerJoinClassesList.get(j);
									if (innerJoinClasses.contains(fromIdx) && innerJoinClasses.contains(toIdx)) {
										innerJoinSqlIndex = j;
										break;
									}
								}
								innerJoinSqls.set(innerJoinSqlIndex, innerJoinSqls.get(innerJoinSqlIndex) + " and `" + fromClassAlias[1] + "`." + fromField + " = `" + toClassAlias[1] + "`." + toField);
								inJoinRelIndexes.add(i);
							}
						}
					}
					if (inJoinRelIndexes.size() == relationships.size() || inJoinRelIndexes.size() == inJoinRelCount) {
						break;
					}
				}
				for (String innerJoinSql : innerJoinSqls) {
					subSelectFrom += innerJoinSql + "\n";
				}
			} else {
				subSelectFrom = objects.getJSONObject(0).getString("class") + " as `" + objects.getJSONObject(0).getString("variable") + "`";
			}
			// Generate the select clause of the sub-query
			String subSelectSelect = "";
			JSONArray outputFields = firstStep.getJSONObject("output").getJSONArray("fields");
			for (int i = 0; i < outputFields.size(); i++) {
				JSONObject field = outputFields.getJSONObject(i);
				String colSql = (field.getBoolean("distinct") != null && field.getBoolean("distinct") ? "distinct " : "") + "`" + field.getString("variable") + "`." + field.getString("field");
				if (field.getString("function") != null) {
					colSql = field.getString("function") + "(" + colSql + ")";
				}
				colSql += " as `" + field.getString("as") + "`";
				subSelectSelect += colSql + (i == outputFields.size() - 1 ? "" : ",");
			}
			// Complete SQL of the sub-query
			String subSelectSql = "select \n"
								+ "    " + subSelectSelect + "\n"
								+ "from \n"
								+ "    " + subSelectFrom + "\n"
								+ ("".equals(subSelectWhere) ? "" : "where\n    " + subSelectWhere);
			// If there is a second step, group by, order by and limit are written on the second step, otherwise they are written on the first step
			if (steps.size() == 1) {
				if (firstStep.getJSONObject("output").getJSONObject("group_by") != null) {
					JSONObject groupBy = firstStep.getJSONObject("output").getJSONObject("group_by");
					if (groupBy.getJSONArray("fields") != null && groupBy.getJSONArray("fields").size() > 0) {
						subSelectSql += "\ngroup by\n    ";
						for (int i = 0; i < groupBy.getJSONArray("fields").size(); i++) {
							JSONObject field = groupBy.getJSONArray("fields").getJSONObject(i);
							subSelectSql += "`" + field.getString("variable") + "`." + field.getString("field") + (i == groupBy.getJSONArray("fields").size() - 1 ? "" : ",");
						}
						if (groupBy.getJSONArray("having") != null && groupBy.getJSONArray("having").size() > 0) {
							subSelectSql += "\nhaving\n    ";
							for (int i = 0; i < groupBy.getJSONArray("having").size(); i++) {
								JSONObject havingCond = groupBy.getJSONArray("having").getJSONObject(i);
								subSelectSql += havingCond.getString("function") + "(" 
												+ (havingCond.getBoolean("distinct") != null && havingCond.getBoolean("distinct") ? "distinct" : "") + " `" + havingCond.getString("variable") + "`." + havingCond.getString("field")
												+ ") " + havingCond.getString("operator") + " " + havingCond.get("value") + (i == groupBy.getJSONArray("having").size() - 1 ? "" : " and ");
							}
						}
					}
				}
				if (firstStep.getJSONObject("output").getJSONObject("sort") != null) {
					JSONObject orderBy = firstStep.getJSONObject("output").getJSONObject("sort");
					if (orderBy.getJSONArray("fields") != null && orderBy.getJSONArray("fields").size() > 0) {
						subSelectSql += "\norder by\n    ";
						for (int i = 0; i < orderBy.getJSONArray("fields").size(); i++) {
							JSONObject order = orderBy.getJSONArray("fields").getJSONObject(i);
							subSelectSql += "`" + order.getString("field") + "` " + ("desc".equals(order.getString("order")) ? "desc" : "") + (i == orderBy.getJSONArray("fields").size() - 1 ? "" : ",");
						}
					}
				}
				if (firstStep.getJSONObject("output").getJSONObject("limit") != null) {
					Integer offset = firstStep.getJSONObject("output").getJSONObject("limit").getInteger("offset") != null ? firstStep.getJSONObject("output").getJSONObject("limit").getInteger("offset") : 0;
					subSelectSql += "\nlimit " + offset + ", " + firstStep.getJSONObject("output").getJSONObject("limit").getInteger("count");
				}
				return subSelectSql;
			} else {
				JSONObject secondStep = steps.getJSONObject(1);
				String tmpClassAs = secondStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects").getJSONObject(0).getString("variable");
				JSONArray secondOutputFields = secondStep.getJSONObject("output").getJSONArray("fields");
				String select = "";
				for (int i = 0; i < secondOutputFields.size(); i++) {
					JSONObject field = secondOutputFields.getJSONObject(i);
					String colSql = "";
					if (field.getString("variable") != null) {
						colSql = (field.getBoolean("distinct") != null && field.getBoolean("distinct") ? "distinct " : "") + "`" + tmpClassAs + "`.`" + field.getString("field") + "`";
						if (field.getString("function") != null) {
							colSql = field.getString("function") + "(" + colSql + ")";
						}
					} else {
						colSql = field.getString("field");
						if (field.getBoolean("distinct") != null && field.getBoolean("distinct")) {
							colSql = "distinct " + colSql;
						}
						if (field.getString("function") != null) {
							colSql = field.getString("function") + "(" + colSql + ")";
						}
					}
					colSql += " as `" + field.getString("as") + "`";
					select += colSql + (i == secondOutputFields.size() - 1 ? "" : ",");
				}
				String sql = "select\n"
						+ "    " + select + "\n"
						+ "from (\n"
						+ subSelectSql + "\n"
						+ ") as `" + tmpClassAs + "`";
				if (secondStep.getJSONObject("output").getJSONObject("group_by") != null) {
					JSONObject groupBy = secondStep.getJSONObject("output").getJSONObject("group_by");
					if (groupBy.getJSONArray("fields") != null && groupBy.getJSONArray("fields").size() > 0) {
						sql += "\ngroup by\n    ";
						for (int i = 0; i < groupBy.getJSONArray("fields").size(); i++) {
							JSONObject field = groupBy.getJSONArray("fields").getJSONObject(i);
							sql += "`" + tmpClassAs + "`.`" + field.getString("field") + "`" + (i == groupBy.getJSONArray("fields").size() - 1 ? "" : ",");
						}
						if (groupBy.getJSONArray("having") != null && groupBy.getJSONArray("having").size() > 0) {
							sql += "\nhaving\n    ";
							for (int i = 0; i < groupBy.getJSONArray("having").size(); i++) {
								JSONObject havingCond = groupBy.getJSONArray("having").getJSONObject(i);
								sql += havingCond.getString("function") + "(" 
												+ (havingCond.getBoolean("distinct") != null && havingCond.getBoolean("distinct") ? "distinct" : "") + " `" + tmpClassAs + "`.`" + havingCond.getString("field") + "`"
												+ ") " + havingCond.getString("operator") + " " + havingCond.get("value") + (i == groupBy.getJSONArray("having").size() - 1 ? "" : " and ");
							}
						}
					}
				}
				if (secondStep.getJSONObject("output").getJSONObject("sort") != null) {
					JSONObject orderBy = secondStep.getJSONObject("output").getJSONObject("sort");
					if (orderBy.getJSONArray("fields") != null && orderBy.getJSONArray("fields").size() > 0) {
						sql += "\norder by\n    ";
						for (int i = 0; i < orderBy.getJSONArray("fields").size(); i++) {
							JSONObject order = orderBy.getJSONArray("fields").getJSONObject(i);
							sql += "`" + order.getString("field") + "` " + ("desc".equals(order.getString("order")) ? "desc" : "") + (i == orderBy.getJSONArray("fields").size() - 1 ? "" : ",");
						}
					}
				}
				if (secondStep.getJSONObject("output").getJSONObject("limit") != null) {
					Integer offset = secondStep.getJSONObject("output").getJSONObject("limit").getInteger("offset") != null ? secondStep.getJSONObject("output").getJSONObject("limit").getInteger("offset") : 0;
					sql += "\nlimit " + offset + ", " + secondStep.getJSONObject("output").getJSONObject("limit").getInteger("count");
				}
				return sql;
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Failed to convert DSL to SQL");
		}
	}

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			String sampleDataContent = "";
			String select = "";
	    	for (int i = 0; i < attrs.size(); i++) {
	    		select += attrs.get(i);
	    		if (i < attrs.size() - 1) {
	    			select += ", ";
	    		}
	    	}
	    	String sql = "select " + select + " from " + className + " limit 1";
	    	JSONArray data = executeSql(sql);
	    	if (data.size() > 0) {
	        	JSONObject datum = data.getJSONObject(0);
	        	Set<String> keys = datum.keySet();
	        	for (String key : keys) {
	        		Object value = datum.get(key);
	        		if (value != null && value instanceof String) {
	        			String str = (String)value;
	        			if (str.length() > 100) {
	        				datum.put(key, str.substring(0, 100) + "...");
	        			}
	        		}
	        	}
	        	sampleDataContent = datum.toString();
	        } else {
	        	sampleDataContent = className + " class has no data";
	        }
	    	return sampleDataContent;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}
	
	private JSONArray executeSql(String sql) throws Exception {
		log.info(sql);
		SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
		Connection conn = null;
		PreparedStatement pst = null;
		ResultSet rs = null;
		try {
			JSONArray rows = new JSONArray();
			conn = openConnection();
			pst = conn.prepareStatement(sql);
			rs = pst.executeQuery();
			ResultSetMetaData meta = rs.getMetaData();
			while (rs.next()) {
				JSONObject row = new JSONObject();
                for (int i = 1; i <= meta.getColumnCount(); i++) {
                	Object value = rs.getObject(i);
                	if (value == null) {
                		row.put(meta.getColumnLabel(i), null);
                	} else {
                		if (value instanceof Timestamp) {
                			row.put(meta.getColumnLabel(i), sdf.format((Timestamp)value));
                		} else if (value instanceof Date) {
                			row.put(meta.getColumnLabel(i), sdf.format((Date)value));
                		} else {
                			row.put(meta.getColumnLabel(i), value);
                		}
                	}
                }
                rows.add(row);
			}
			return rows;
		} catch (Exception e) {
			throw e;
		} finally {
			if (rs != null) {
				try {
					rs.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
			if (pst != null) {
				try {
					pst.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
			if (conn != null) {
				try {
					conn.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
	}

	@Override
	public void validatePrimaryKeyName(String attrName) throws Exception {
	}

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		return sandboxId + className;
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	@Override
	public void validateClassNameFormat(String className) throws Exception {
		
	}

	@Override
	public void createNamespace(String namespace) {
	}

	@Override
	public void truncateNamespace(String namespace) {
		try {
			JSONArray currentSchemas = executeSql("SELECT DATABASE() AS current_schema;");
			String currentSchema = currentSchemas.getJSONObject(0).getString("current_schema");
			JSONArray tableNames = executeSql("SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = '" + currentSchema + "' AND table_type = 'BASE TABLE';");
			for (int i = 0; i < tableNames.size(); i++) {
				String tableName = tableNames.getJSONObject(i).getString("table_name");
				if (namespace == null || tableName.toLowerCase().startsWith(namespace.toLowerCase())) {
					executeUpdate("delete from " + tableName);
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void dropNamespace(String namespace) {
		try {
			JSONArray currentSchemas = executeSql("SELECT DATABASE() AS current_schema;");
			String currentSchema = currentSchemas.getJSONObject(0).getString("current_schema");
			JSONArray tableNames = executeSql("SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = '" + currentSchema + "' AND table_type = 'BASE TABLE';");
			for (int i = 0; i < tableNames.size(); i++) {
				String tableName = tableNames.getJSONObject(i).getString("table_name");
				if (namespace == null || tableName.toLowerCase().startsWith(namespace.toLowerCase())) {
					executeUpdate("drop table " + tableName);
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		try {
			String fullClassName = namespace + ((String) classDef.get("className")).trim();
			List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
			List<String> fields = new ArrayList<String>();
			if (attrs != null) {
				for (Map<String, Object> attr : attrs) {
					if (attr.get("enable") == null || (Boolean)attr.get("enable")) {
						String name = (String) attr.get("name");
						String type = (String) attr.get("type");
						if (name != null && isSupportedType(type)) {
							String ty = "";
							if ("varchar".equals(type)) {
								ty = "varchar(200)";
							} else if ("text".equals(type)) {
								ty = "text";
							} else if ("int".equals(type)) {
								ty = "int";
							} else if ("long".equals(type)) {
								ty = "bigint";
							} else if ("double".equals(type)) {
								ty = "double";
							} else if ("date".equals(type)) {
								ty = "date";
							} else if ("timestamp".equals(type)) {
								ty = "datetime";
							} else if ("vector".equals(type)) {
								ty = "text";
							}
							fields.add(name + " " + ty);
						}
					}
				}
			}

			StringBuilder sql = new StringBuilder();
			sql.append("create table ").append(fullClassName).append(" ( \n");
			for (int i = 0; i < fields.size(); i++) {
				String field = fields.get(i);
				sql.append(" ").append(field).append(" " + (i == fields.size() - 1 ? "" : ",") + "\n");
			}
			sql.append(" );");
			executeUpdate(sql.toString());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	private boolean isSupportedType(String type) {
		return "varchar".equals(type) || "text".equals(type) || "int".equals(type) || "long".equals(type)
				|| "double".equals(type) || "date".equals(type) || "timestamp".equals(type)
				|| "vector".equals(type);
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		int idIndex = -1;
		List<String> fields = new ArrayList<String>();
		Map<String, String> attrTypeMap = new HashMap<String, String>();
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
							idIndex = fields.size();
						}
						fields.add((String) attrDef.get("name"));
						attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					}
				}
			}
		}

		if (idIndex >= 0) {
			String pk = fields.get(idIndex);
			List<String> sqls = new ArrayList<String>();
			for (int i = 0; i < objs.size(); i++) {
				JSONObject obj = objs.getJSONObject(i);
				if (obj.get(pk) == null || "".equals(obj.getString(pk).trim())) {
					throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
				}
				StringBuilder sql = new StringBuilder();
				sql.append("insert into ").append(fullClassName).append("(");
				sql.append(String.join(",", fields));
				sql.append(") values(");
				for (int j = 0; j < fields.size(); j++) {
					if (j > 0) {
						sql.append(",");
					}
					String type = attrTypeMap.get(fields.get(j));
					Object value = obj.get(fields.get(j));
					if (value != null) {
						sql.append(toSqlValue(type, value, ymd, ymdhms));
					} else {
						sql.append("null");
					}
				}
				sql.append(")");
				sqls.add(sql.toString());
			}
			executeUpdate(sqls);
		} else {
			throw new Exception("The insert statement must contain the primary key field");
		}
	}

	private boolean inSandbox(String sandboxId) {
		return sandboxId != null && !"".equals(sandboxId.trim());
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<String, String>();
		String pk = null;
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
							pk = (String) attrDef.get("name");
						}
						attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					}
				}
			}
		}

		String setStr = "";
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			String type = attrTypeMap.get(key);
			if (type != null) {
				Object value = setValues.get(key);
				setStr += key + " = ";
				if (value != null) {
					setStr += toSqlValue(type, value, ymd, ymdhms);
				} else {
					setStr += "null";
				}
				setStr += ",";
			} else {
				throw new Exception("Field [" + key + "] does not exist");
			}
		}
		if (setStr.length() > 0) {
			setStr = setStr.substring(0, setStr.length() - 1);
		}
		String sql = "update " + fullClassName + " set " + setStr;
		String whereStr = generateWhere(where, attrTypeMap, ymd, ymdhms);
		if (!"".equals(whereStr.trim())) {
			sql += " where " + whereStr;
		}

		executeUpdate(sql);
	}

	private String generateWhere(JSONObject condition, Map<String, String> attrTypeMap, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
		String whereStr = "";
		if (condition != null) {
			whereStr = buildWhere(condition, true, attrTypeMap, ymd, ymdhms);
		}
		return whereStr;
	}

	private String buildWhere(JSONObject condition, boolean topLevel, Map<String, String> attrTypeMap, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
		String operator = condition.getString("operator");
		if (operator == null) {
			operator = "";
		}

		if (condition.getJSONArray("and") != null && condition.getJSONArray("and").size() > 0 || condition.getJSONArray("or") != null && condition.getJSONArray("or").size() > 0) {
			String connector;
			JSONArray list;
			if (condition.containsKey("and")) {
				connector = " and ";
				list = condition.getJSONArray("and");
			} else if (condition.containsKey("or")) {
				connector = " or ";
				list = condition.getJSONArray("or");
			} else {
				return "";
			}
			List<String> parts = new ArrayList<String>();
			for (int i = 0; i < list.size(); i++) {
				parts.add(buildWhere(list.getJSONObject(i), false, attrTypeMap, ymd, ymdhms));
			}
			String joined = String.join(connector, parts);
			return topLevel ? joined : "(" + joined + ")";
		}

		String field = condition.getString("field");
		String type = attrTypeMap.get(field);
		switch (operator) {
			case "=":
			case "!=":
			case ">":
			case ">=":
			case "<":
			case "<=":
			case "like":
				Object value = condition.get("value");
				String valueSql = toSqlValue(type, value, ymd, ymdhms);
				return field + " " + operator + " " + valueSql;
			case "between":
				JSONArray betweenArr = condition.getJSONArray("value");
				return field + " between " + toSqlValue(type, betweenArr.get(0), ymd, ymdhms) + " and " + toSqlValue(type, betweenArr.get(1), ymd, ymdhms);
			case "in":
				JSONArray vs = condition.getJSONArray("value");
				String inValue = "(";
				for (int i = 0; i < vs.size(); i++) {
					inValue += toSqlValue(type, vs.get(i), ymd, ymdhms) + (i == vs.size() - 1 ? ")" : ",");
				}
				return field + " in " + inValue;
			case "is":
				return field + " is null";
			case "is not":
				return field + " is not null";
			default:
				return "";
		}
	}

	private String toSqlValue(String type, Object value, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
		String valueSql = "";
		if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
			String strValue = "vector".equals(type) && value != null && !(value instanceof String)
					? JSON.toJSONString(value) : (String) value;
			valueSql = "'" + strValue.replace("'", "''") + "'";
		} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
			valueSql = value + "";
		} else if ("date".equals(type)) {
			try {
				valueSql = "'" + ymd.format(ymd.parse((String) value)) + "'";
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a date field, expected yyyy-MM-dd");
			}
		} else if ("timestamp".equals(type)) {
			try {
				valueSql = "'" + ymdhms.format(ymdhms.parse((String) value)) + "'";
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a timestamp field, expected yyyy-MM-dd HH:mm:ss");
			}
		}
		return valueSql;
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<String, String>();
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					}
				}
			}
		}

		String sql = "delete from " + fullClassName;
		String whereStr = generateWhere(where, attrTypeMap, ymd, ymdhms);
		if (!"".equals(whereStr.trim())) {
			sql += " where " + whereStr;
		}

		executeUpdate(sql);
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		boolean inSandbox = inSandbox(namespace);

		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		Map<String, Object> relDef = (Map<String, Object>) relationship_rule.get(relationName);

		if (relDef != null && sourceClassDef != null && targetClassDef != null && relDef.get("fromclass").equals(sourceClassName) && relDef.get("toclass").equals(targetClassName)) {
			String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
			String targetPk = DslUtil.getPrimaryKey(targetClassDef);
			String sourceInnerField = (String) relDef.get("fromField");
			String targetInnerField = (String) relDef.get("toField");

			String sql = null;
			if (sourcePk.equals(sourceInnerField)) {
				if (targetPk.equals(targetInnerField)) {
				} else {
					String fullClassName = inSandbox ? namespace + ((String) targetClassDef.get("className")) : (String) targetClassDef.get("className");
					sql = "update " + fullClassName + " set " + targetInnerField + " = " + toSqlValue("varchar", sourceObjId, null, null) + " where " + targetPk + " = " + toSqlValue("varchar", targetObjId, null, null);
				}
			} else {
				if (targetPk.equals(targetInnerField)) {
					String fullClassName = inSandbox ? namespace + ((String) sourceClassDef.get("className")) : (String) sourceClassDef.get("className");
					sql = "update " + fullClassName + " set " + sourceInnerField + " = " + toSqlValue("varchar", targetObjId, null, null) + " where " + sourcePk + " = " + toSqlValue("varchar", sourceObjId, null, null);
				} else {
				}
			}

			if (sql != null) {
				executeUpdate(sql);
			}
		} else {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName + "] have no relationship definition [" + relationName + "]");
		}
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		boolean inSandbox = inSandbox(namespace);

		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		Map<String, Object> relDef = (Map<String, Object>) relationship_rule.get(relationName);

		if (relDef != null && sourceClassDef != null && targetClassDef != null && relDef.get("fromclass").equals(sourceClassName) && relDef.get("toclass").equals(targetClassName)) {
			String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
			String targetPk = DslUtil.getPrimaryKey(targetClassDef);
			String sourceInnerField = (String) relDef.get("fromField");
			String targetInnerField = (String) relDef.get("toField");

			String sql = null;
			if (sourcePk.equals(sourceInnerField)) {
				if (targetPk.equals(targetInnerField)) {
				} else {
					String fullClassName = inSandbox ? namespace + ((String) targetClassDef.get("className")) : (String) targetClassDef.get("className");
					sql = "update " + fullClassName + " set " + targetInnerField + " = null where " + targetPk + " = " + toSqlValue("varchar", targetObjId, null, null);
				}
			} else {
				if (targetPk.equals(targetInnerField)) {
					String fullClassName = inSandbox ? namespace + ((String) sourceClassDef.get("className")) : (String) sourceClassDef.get("className");
					sql = "update " + fullClassName + " set " + sourceInnerField + " = null where " + sourcePk + " = " + toSqlValue("varchar", sourceObjId, null, null);
				} else {
				}
			}

			if (sql != null) {
				executeUpdate(sql);
			}
		} else {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName + "] have no relationship definition [" + relationName + "]");
		}
	}

	private void executeUpdate(String sql) throws Exception {
		List<String> sqls = new ArrayList<String>();
		sqls.add(sql);
		executeUpdate(sqls);
	}

	private void executeUpdate(List<String> sqls) throws Exception {
		Connection conn = null;
		Statement st = null;

		try {
			conn = openConnection();
			conn.setAutoCommit(false);
			st = conn.createStatement();
			for (String sql : sqls) {
				log.info(sql);
				st.addBatch(sql);
			}
			st.executeBatch();
			conn.commit();
		} catch (Exception e) {
			if (conn != null) {
				try {
					conn.rollback();
				} catch (Exception e1) {
					log.error(e1.getMessage(), e1);
				}
			}
			throw e;
		} finally {
			if (st != null) {
				try { st.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (conn != null) {
				try { conn.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
		}
	}

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String fullClassName = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		String sql = "select " + attrName + " from " + fullClassName + " where " + pk + " = '" + objectId.replace("'", "''") + "'";
		JSONArray rows = executeSql(sql);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + fullClassName + " does not exist");
		}
		Object value = rows.getJSONObject(0).get(attrName);
		return DslUtil.parseVectorAttr(value);
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception {
		boolean inSandbox = inSandbox(sandboxId);

		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs);

		JSONObject dataMap = new JSONObject();
		DslExecutionResult result = null;
		JSONObject data = null;
		if (inSandbox) {
			for (Map<String, Object> classDef : classDefs) {
				String className = sandboxId + ((String) classDef.get("className")).trim();
				classDef.put("className", className);
			}
			String sandboxDslStr = addSandboxId(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		}

		dataMap.putAll(data);
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

	private String addSandboxId(String dslStr, String sandboxId) {
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject dsl = dsls.getJSONObject(dslIndex);
			JSONObject answer = dsl == null ? null : dsl.getJSONObject("answer");
			JSONArray steps = answer == null ? null : answer.getJSONArray("steps");
			if (steps == null) {
				continue;
			}

			JSONObject step = steps.getJSONObject(0);
			JSONObject graph = step == null ? null : step.getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
			if (objects == null) {
				continue;
			}
			for (int objectIndex = 0; objectIndex < objects.size(); objectIndex++) {
				JSONObject object = objects.getJSONObject(objectIndex);
				if (object != null) {
					String fullClassName = sandboxId + object.getString("class").trim();
					object.put("class", fullClassName);
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}

}
