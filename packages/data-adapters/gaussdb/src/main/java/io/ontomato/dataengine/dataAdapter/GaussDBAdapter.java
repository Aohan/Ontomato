package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.text.SimpleDateFormat;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
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
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil.M3Mode;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class GaussDBAdapter implements DataAdapter {

	private DataAdapterConnection connection;
	private Map<String, Object> jsonRule;

	public GaussDBAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	@Override
	public String executeDsl(String queryJson, String sessionId, M3Mode m3Mode, List<String> generatedMqls) throws Exception {
		log.info("[" + sessionId + "] DSL to query GaussDB: " + queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		String sql = toSql(dsls.getJSONObject(0), jsonRule);
		generatedMqls.add(sql);
		log.info("[" + sessionId + "] Converted GaussDB sql: " + sql);
		JSONArray data = executeSql(connection, sql);
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", data);
		answer.put("mqls", generatedMqls);
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	private String toSql(JSONObject dsl, Map<String, Object> jsonRule) throws Exception {
		try {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
			Map<String, Map<String, String>> classAttrTypeMap = new HashMap<>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> attrTypeMap = new HashMap<>();
				@SuppressWarnings("unchecked")
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
				}
				classAttrTypeMap.put((String) classDef.get("className"), attrTypeMap);
			}
			@SuppressWarnings("unchecked")
			Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");

			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);

			JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("objects");
			String subSelectWhere = "";
			Map<Integer, String[]> idxMap = new HashMap<>();
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				String className = object.getString("class");
				String alias = object.getString("variable");
				idxMap.put(object.getInteger("idx"), new String[] { className, alias });
				Map<String, String> attrTypeMap = classAttrTypeMap.get(className);
				String objWhere = "";
				if (object.getJSONObject("conditions") != null) {
					JSONObject conditions = object.getJSONObject("conditions");
					if (conditions.getJSONObject("properties") != null) {
						JSONObject properties = conditions.getJSONObject("properties");
						List<Object[]> queue = new ArrayList<>();
						queue.add(new Object[] { properties, null });
						while (!queue.isEmpty()) {
							Object[] objs = queue.removeFirst();
							JSONObject cond = objs[0] == null ? null : (JSONObject) objs[0];
							String and_or_end = objs[1] == null ? null : (String) objs[1];
							if (cond == null && and_or_end != null) {
								objWhere += and_or_end;
							} else if (cond.getJSONArray("and") != null && cond.getJSONArray("and").size() > 0) {
								objWhere += "(";
								List<Object[]> newQueue = new ArrayList<>();
								JSONArray ands = cond.getJSONArray("and");
								for (int j = 0; j < ands.size(); j++) {
									JSONObject and = ands.getJSONObject(j);
									newQueue.add(new Object[] { and, null });
									if (j < ands.size() - 1) {
										newQueue.add(new Object[] { null, " and " });
									}
								}
								newQueue.add(new Object[] { null, ")" });
								newQueue.addAll(queue);
								queue = newQueue;
							} else if (cond.getJSONArray("or") != null && cond.getJSONArray("or").size() > 0) {
								objWhere += "(";
								List<Object[]> newQueue = new ArrayList<>();
								JSONArray ors = cond.getJSONArray("or");
								for (int j = 0; j < ors.size(); j++) {
									JSONObject or = ors.getJSONObject(j);
									newQueue.add(new Object[] { or, null });
									if (j < ors.size() - 1) {
										newQueue.add(new Object[] { null, " or " });
									}
								}
								newQueue.add(new Object[] { null, ")" });
								newQueue.addAll(queue);
								queue = newQueue;
							} else {
								String attr = cond.getString("field");
								String type = attrTypeMap.get(attr);
								String sqlCond = null;
								if ("=".equals(cond.getString("operator"))
										|| "!=".equals(cond.getString("operator"))) {
									if ("varchar".equals(type)) {
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " '" + cond.getString("value").replace("'", "''") + "'";
									} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " " + cond.get("value");
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " TO_TIMESTAMP(" + cond.getLong("value") + ")";
									}
								} else if ("like".equals(cond.getString("operator"))
										|| "not like".equals(cond.getString("operator"))) {
									if ("varchar".equals(type)) {
										String value = cond.getString("value").replace("'", "''").trim();
										if (!value.startsWith("%") && !value.endsWith("%")) {
											value = "%" + value + "%";
										}
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " '" + value + "'";
									}
								} else if (">".equals(cond.getString("operator"))
										|| ">=".equals(cond.getString("operator"))
										|| "<=".equals(cond.getString("operator"))
										|| "<".equals(cond.getString("operator"))) {
									if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " " + cond.get("value");
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator")
												+ " TO_TIMESTAMP(" + cond.getLong("value") + ")";
									}
								} else if ("between".equals(cond.getString("operator"))) {
									JSONArray value = cond.getJSONArray("value");
									if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										sqlCond = "(\"" + alias + "\".\"" + attr + "\" >= " + value.get(0)
												+ " and \"" + alias + "\".\"" + attr + "\" <= " + value.get(1) + ")";
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										sqlCond = "(\"" + alias + "\".\"" + attr + "\" >= TO_TIMESTAMP("
												+ value.getLong(0) + ") and \"" + alias + "\".\"" + attr
												+ "\" <= TO_TIMESTAMP(" + value.getLong(1) + "))";
									}
								} else if ("in".equals(cond.getString("operator"))) {
									JSONArray value = cond.getJSONArray("value");
									if ("varchar".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += "'" + value.getString(j).replace("'", "''") + "',";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "\"" + alias + "\".\"" + attr + "\" in " + in;
									} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += value.get(j) + ",";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "\"" + alias + "\".\"" + attr + "\" in " + in;
									} else if ("date".equals(type) || "timestamp".equals(type)) {
										String in = "";
										for (int j = 0; j < value.size(); j++) {
											in += "TO_TIMESTAMP(" + value.getLong(j) + "),";
										}
										in = "(" + in.substring(0, in.length() - 1) + ")";
										sqlCond = "\"" + alias + "\".\"" + attr + "\" in " + in;
									}
								} else if ("is".equals(cond.getString("operator"))
										|| "is not".equals(cond.getString("operator"))) {
									sqlCond = "\"" + alias + "\".\"" + attr + "\" " + cond.getString("operator") + " null";
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

			String subSelectFrom = "";
			JSONArray relationships = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("relationship");
			if (relationships != null && relationships.size() > 0) {
				Set<Integer> inJoinIdxs = new HashSet<>();
				Set<Integer> inJoinRelIndexes = new HashSet<>();
				List<String> innerJoinSqls = new ArrayList<>();
				List<Set<Integer>> innerJoinClassesList = new ArrayList<>();
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
							@SuppressWarnings("unchecked")
							Map<String, Object> relationDef = (Map<String, Object>) relationship_rule
									.get(relationshipName);
							String fromField = (String) relationDef.get("fromField");
							String toField = (String) relationDef.get("toField");
							if (inJoinIdxs.isEmpty()) {
								innerJoinSqls.add(fromClassAlias[0] + " as \"" + fromClassAlias[1] + "\""
										+ " inner join " + toClassAlias[0] + " as \"" + toClassAlias[1] + "\""
										+ " on \"" + fromClassAlias[1] + "\".\"" + fromField
										+ "\" = \"" + toClassAlias[1] + "\".\"" + toField + "\"");
								inJoinIdxs.add(fromIdx);
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && !inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + toClassAlias[0] + " as \"" + toClassAlias[1] + "\""
										+ " on \"" + fromClassAlias[1] + "\".\"" + fromField
										+ "\" = \"" + toClassAlias[1] + "\".\"" + toField + "\"");
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (!inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + fromClassAlias[0] + " as \"" + fromClassAlias[1] + "\""
										+ " on \"" + fromClassAlias[1] + "\".\"" + fromField
										+ "\" = \"" + toClassAlias[1] + "\".\"" + toField + "\"");
								inJoinIdxs.add(fromIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
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
								innerJoinSqls.set(innerJoinSqlIndex,
										innerJoinSqls.get(innerJoinSqlIndex) + " and \""
												+ fromClassAlias[1] + "\".\"" + fromField
												+ "\" = \"" + toClassAlias[1] + "\".\"" + toField + "\"");
								inJoinRelIndexes.add(i);
							}
						}
					}
					if (inJoinRelIndexes.size() == relationships.size()
							|| inJoinRelIndexes.size() == inJoinRelCount) {
						break;
					}
				}
				for (String innerJoinSql : innerJoinSqls) {
					subSelectFrom += innerJoinSql + "\n";
				}
			} else {
				subSelectFrom = objects.getJSONObject(0).getString("class") + " as \""
						+ objects.getJSONObject(0).getString("variable") + "\"";
			}

			String subSelectSelect = "";
			JSONArray outputFields = firstStep.getJSONObject("output").getJSONArray("fields");
			for (int i = 0; i < outputFields.size(); i++) {
				JSONObject field = outputFields.getJSONObject(i);
				String colSql = (field.getBoolean("distinct") != null && field.getBoolean("distinct") ? "distinct "
						: "")
						+ "\"" + field.getString("variable") + "\".\"" + field.getString("field") + "\"";
				if (field.getString("function") != null) {
					colSql = field.getString("function") + "(" + colSql + ")";
				}
				colSql += " as \"" + field.getString("as") + "\"";
				subSelectSelect += colSql + (i == outputFields.size() - 1 ? "" : ",");
			}

			String subSelectSql = "select \n"
					+ "    " + subSelectSelect + "\n"
					+ "from \n"
					+ "    " + subSelectFrom + "\n"
					+ ("".equals(subSelectWhere) ? "" : "where\n    " + subSelectWhere);

			if (steps.size() == 1) {
				subSelectSql = appendGroupByHaving(firstStep, subSelectSql, null);
				subSelectSql = appendOrderBy(firstStep, subSelectSql, null);
				subSelectSql = appendLimit(firstStep, subSelectSql);
				return subSelectSql;
			} else {
				JSONObject secondStep = steps.getJSONObject(1);
				String tmpClassAs = secondStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
						.getJSONArray("objects").getJSONObject(0).getString("variable");
				JSONArray secondOutputFields = secondStep.getJSONObject("output").getJSONArray("fields");
				String select = "";
				for (int i = 0; i < secondOutputFields.size(); i++) {
					JSONObject field = secondOutputFields.getJSONObject(i);
					String colSql = "";
					if (field.getString("variable") != null) {
						colSql = (field.getBoolean("distinct") != null && field.getBoolean("distinct") ? "distinct "
								: "")
								+ "\"" + tmpClassAs + "\".\"" + field.getString("field") + "\"";
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
					colSql += " as \"" + field.getString("as") + "\"";
					select += colSql + (i == secondOutputFields.size() - 1 ? "" : ",");
				}
				String sql = "select\n"
						+ "    " + select + "\n"
						+ "from (\n"
						+ subSelectSql + "\n"
						+ ") as \"" + tmpClassAs + "\"";

				sql = appendGroupByHaving(secondStep, sql, tmpClassAs);
				sql = appendOrderBy(secondStep, sql, tmpClassAs);
				sql = appendLimit(secondStep, sql);
				return sql;
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Failed to convert DSL to SQL");
		}
	}

	private String appendGroupByHaving(JSONObject step, String sql, String tmpClassAs) {
		if (step.getJSONObject("output").getJSONObject("group_by") == null) {
			return sql;
		}
		JSONObject groupBy = step.getJSONObject("output").getJSONObject("group_by");
		if (groupBy.getJSONArray("fields") != null && groupBy.getJSONArray("fields").size() > 0) {
			sql += "\ngroup by\n    ";
			for (int i = 0; i < groupBy.getJSONArray("fields").size(); i++) {
				JSONObject field = groupBy.getJSONArray("fields").getJSONObject(i);
				if (tmpClassAs != null) {
					sql += "\"" + tmpClassAs + "\".\"" + field.getString("field") + "\"";
				} else {
					sql += "\"" + field.getString("variable") + "\".\"" + field.getString("field") + "\"";
				}
				sql += (i == groupBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
			if (groupBy.getJSONArray("having") != null && groupBy.getJSONArray("having").size() > 0) {
				sql += "\nhaving\n    ";
				for (int i = 0; i < groupBy.getJSONArray("having").size(); i++) {
					JSONObject havingCond = groupBy.getJSONArray("having").getJSONObject(i);
					String ref = tmpClassAs != null
							? "\"" + tmpClassAs + "\".\"" + havingCond.getString("field") + "\""
							: (havingCond.getBoolean("distinct") != null && havingCond.getBoolean("distinct")
									? "distinct "
									: "")
									+ " \"" + havingCond.getString("variable") + "\".\""
									+ havingCond.getString("field") + "\"";
					sql += havingCond.getString("function") + "(" + ref
							+ ") " + havingCond.getString("operator") + " " + havingCond.get("value")
							+ (i == groupBy.getJSONArray("having").size() - 1 ? "" : " and ");
				}
			}
		}
		return sql;
	}

	private String appendOrderBy(JSONObject step, String sql, String tmpClassAs) {
		if (step.getJSONObject("output").getJSONObject("sort") == null) {
			return sql;
		}
		JSONObject orderBy = step.getJSONObject("output").getJSONObject("sort");
		if (orderBy.getJSONArray("fields") != null && orderBy.getJSONArray("fields").size() > 0) {
			sql += "\norder by\n    ";
			for (int i = 0; i < orderBy.getJSONArray("fields").size(); i++) {
				JSONObject order = orderBy.getJSONArray("fields").getJSONObject(i);
				sql += "\"" + order.getString("field") + "\" "
						+ ("desc".equals(order.getString("order")) ? "desc" : "")
						+ (i == orderBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
		}
		return sql;
	}

	private String appendLimit(JSONObject step, String sql) {
		if (step.getJSONObject("output").getJSONObject("limit") == null) {
			return sql;
		}
		Integer offset = step.getJSONObject("output").getJSONObject("limit").getInteger("offset");
		if (offset == null) {
			offset = 0;
		}
		sql += "\nlimit " + step.getJSONObject("output").getJSONObject("limit").getInteger("count")
				+ " offset " + offset;
		return sql;
	}

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			String select = "";
			for (int i = 0; i < attrs.size(); i++) {
				select += attrs.get(i);
				if (i < attrs.size() - 1) {
					select += ", ";
				}
			}
			String sql = "select " + select + " from " + className + " limit 1";
			JSONArray data = executeSql(connection, sql);
			if (data.size() > 0) {
				JSONObject datum = data.getJSONObject(0);
				Set<String> keys = datum.keySet();
				for (String key : keys) {
					Object value = datum.get(key);
					if (value != null && value instanceof String) {
						String str = (String) value;
						if (str.length() > 100) {
							datum.put(key, str.substring(0, 100) + "...");
						}
					}
				}
				return datum.toString();
			} else {
				return className + " class has no data";
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}

	private JSONArray executeSql(DataAdapterConnection props, String sql) throws Exception {
		log.info(sql);
		SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
		Connection conn = null;
		PreparedStatement pst = null;
		ResultSet rs = null;
		try {
			JSONArray rows = new JSONArray();
			conn = createDataSource(props).getConnection();
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
							row.put(meta.getColumnLabel(i), sdf.format((Timestamp) value));
						} else if (value instanceof Date) {
							row.put(meta.getColumnLabel(i), sdf.format((Date) value));
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
				try { rs.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (pst != null) {
				try { pst.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (conn != null) {
				try { conn.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
		}
	}

	SimpleDriverDataSource createDataSource(DataAdapterConnection props) {
		String url = props.getUrl();
		if (url != null && url.startsWith("jdbc:postgresql:")) {
			url = "jdbc:opengauss:" + url.substring("jdbc:postgresql:".length());
		}
		return new SimpleDriverDataSource(
				new org.opengauss.Driver(),
				url,
				props.getUser(),
				props.getPassword());
	}

	@Override
	public boolean useM3() {
		return false;
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

	private UnsupportedDataAdapterOperationException unsupported(String operation) {
		return new UnsupportedDataAdapterOperationException("GaussDB", operation);
	}

	@Override
	public void createNamespace(String namespace) {
		throw unsupported("createNamespace");
	}

	@Override
	public void truncateNamespace(String namespace) {
		throw unsupported("truncateNamespace");
	}

	@Override
	public void dropNamespace(String namespace) {
		throw unsupported("dropNamespace");
	}

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		throw unsupported("createClass");
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
		throw unsupported("createEdgeType");
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		throw unsupported("insertObjects");
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		throw unsupported("updateObjects");
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		throw unsupported("deleteObjects");
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		throw unsupported("createEdge");
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		throw unsupported("deleteEdge");
	}

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String fullClassName = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		String sql = "select " + attrName + " from " + fullClassName + " where " + pk + " = '" + objectId.replace("'", "''") + "'";
		JSONArray rows = executeSql(connection, sql);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + fullClassName + " does not exist");
		}
		Object value = rows.getJSONObject(0).get(attrName);
		return DslUtil.parseVectorAttr(value);
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception {
		throw unsupported("query");
	}
}
