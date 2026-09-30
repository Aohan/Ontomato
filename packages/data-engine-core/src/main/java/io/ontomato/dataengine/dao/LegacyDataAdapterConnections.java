package io.ontomato.dataengine.dao;

import com.alibaba.fastjson2.JSONObject;

/**
 * One-time migration of a saved business config from the per-database property objects
 * (mysqlDataAdapterProperties{mysqlUrl,...} and so on) to dataAdapterConnections keyed by adapter type.
 * Runs on the raw JSON because binding drops unknown legacy fields; BusinessConfigDao writes the result back.
 * Remove once every deployment has been upgraded to this version.
 */
final class LegacyDataAdapterConnections {

	// legacy key, adapter type, legacy field prefix
	private static final String[][] LEGACY = {
			{ "mysqlDataAdapterProperties", "mysql", "mysql" },
			{ "pgsqlDataAdapterProperties", "postgresql", "pgsql" },
			{ "oracleDataAdapterProperties", "oracle", "oracle" },
			{ "sqlServerDataAdapterProperties", "sqlserver", "sqlServer" },
			{ "db2DataAdapterProperties", "db2", "db2" },
			{ "gaussDBDataAdapterProperties", "gaussdb", "gaussDB" },
			{ "duckDBDataAdapterProperties", "duckdb", "duckdb" },
			{ "dmDataAdapterProperties", "dm", "dm" },
	};

	private LegacyDataAdapterConnections() {
	}

	/** Moves every legacy property object into dataAdapterConnections; returns whether the record changed. */
	static boolean migrate(JSONObject stored) {
		boolean changed = false;
		for (String[] legacy : LEGACY) {
			if (!stored.containsKey(legacy[0])) {
				continue;
			}
			JSONObject properties = stored.getJSONObject(legacy[0]);
			stored.remove(legacy[0]);
			changed = true;
			if (properties == null) {
				continue;
			}
			JSONObject connections = stored.getJSONObject("dataAdapterConnections");
			if (connections == null) {
				connections = new JSONObject();
				stored.put("dataAdapterConnections", connections);
			}
			String prefix = legacy[2];
			JSONObject connection = new JSONObject();
			connection.put("url", properties.getString(prefix + "Url"));
			connection.put("user", properties.getString(prefix + "User"));
			connection.put("password", properties.getString(prefix + "Password"));
			connections.put(legacy[1], connection);
		}
		return changed;
	}
}
