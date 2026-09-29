package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;

public class DataAdapterFactory {
	
	public static final String M3 = "m3";
	public static final String MYSQL = "mysql";
	public static final String POSTGRESQL = "postgresql";
	public static final String ORACLE = "oracle";
	public static final String SQL_SERVER = "sqlserver";
	public static final String DB2 = "db2";
	public static final String DM = "dm";
	public static final String GAUSSDB = "gaussdb";
	public static final String DUCKDB = "duckdb";

	/**
	 * Whether the configured data adapter is the M3 engine (default).
	 *
	 * <p>Any value that is not one of the known relational adapters falls through to M3 in {@link #getAdapter}.
	 * Keeping this in one place avoids duplicating the adapter-selection branch when only the "is M3" fact is needed.</p>
	 */
	public static boolean isM3(BusinessConfig businessConfig) {
		String da = businessConfig == null ? null : businessConfig.getDataAdapter();
		return !(MYSQL.equals(da) || POSTGRESQL.equals(da) || ORACLE.equals(da) || SQL_SERVER.equals(da)
				|| DB2.equals(da) || DM.equals(da) || GAUSSDB.equals(da) || DUCKDB.equals(da));
	}

	public static DataAdapter getAdapter(DataRagConfig dataRagConfig, BusinessConfig businessConfig, Map<String, Object> jsonRule) {
		DataAdapter adapter = null;
		if (MYSQL.equals(businessConfig.getDataAdapter())) {
			adapter = new MysqlAdapter(businessConfig.getMysqlDataAdapterProperties(), jsonRule);
		} else if (POSTGRESQL.equals(businessConfig.getDataAdapter())) {
			adapter = new PostgreAdapter(businessConfig.getPgsqlDataAdapterProperties(), jsonRule);
		} else if (ORACLE.equals(businessConfig.getDataAdapter())) {
			adapter = new OracleAdapter(businessConfig.getOracleDataAdapterProperties(), jsonRule);
		} else if (SQL_SERVER.equals(businessConfig.getDataAdapter())) {
			adapter = new SqlServerAdapter(businessConfig.getSqlServerDataAdapterProperties(), jsonRule);
		} else if (DB2.equals(businessConfig.getDataAdapter())) {
			adapter = new Db2Adapter(businessConfig.getDb2DataAdapterProperties(), jsonRule);
		} else if (DM.equals(businessConfig.getDataAdapter())) {
			adapter = new DmAdapter(businessConfig.getDmDataAdapterProperties(), jsonRule);
		} else if (GAUSSDB.equals(businessConfig.getDataAdapter())) {
			adapter = new GaussDBAdapter(businessConfig.getGaussDBDataAdapterProperties(), jsonRule);
		} else if (DUCKDB.equals(businessConfig.getDataAdapter())) {
			adapter = new DuckDBAdapter(businessConfig.getDuckDBDataAdapterProperties(), jsonRule);
		} else {
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			adapter = new M3Adapter(dataRagConfig, classDefs);
		}
		return adapter;
	}
	
	public static DataAdapter getAdapter(DataRagConfig dataRagConfig, BusinessConfig businessConfig) {
		DataAdapter adapter = null;
		if (MYSQL.equals(businessConfig.getDataAdapter())) {
			adapter = new MysqlAdapter(businessConfig.getMysqlDataAdapterProperties(), null);
		} else if (POSTGRESQL.equals(businessConfig.getDataAdapter())) {
			adapter = new PostgreAdapter(businessConfig.getPgsqlDataAdapterProperties(), null);
		} else if (ORACLE.equals(businessConfig.getDataAdapter())) {
			adapter = new OracleAdapter(businessConfig.getOracleDataAdapterProperties(), null);
		} else if (SQL_SERVER.equals(businessConfig.getDataAdapter())) {
			adapter = new SqlServerAdapter(businessConfig.getSqlServerDataAdapterProperties(), null);
		} else if (DB2.equals(businessConfig.getDataAdapter())) {
			adapter = new Db2Adapter(businessConfig.getDb2DataAdapterProperties(), null);
		} else if (DM.equals(businessConfig.getDataAdapter())) {
			adapter = new DmAdapter(businessConfig.getDmDataAdapterProperties(), null);
		} else if (GAUSSDB.equals(businessConfig.getDataAdapter())) {
			adapter = new GaussDBAdapter(businessConfig.getGaussDBDataAdapterProperties(), null);
		} else if (DUCKDB.equals(businessConfig.getDataAdapter())) {
			adapter = new DuckDBAdapter(businessConfig.getDuckDBDataAdapterProperties(), null);
		} else {
			adapter = new M3Adapter(dataRagConfig, null);
		}
		return adapter;
	}
	
	public static DataAdapter getAdapter(BusinessConfig businessConfig) {
		DataAdapter adapter = null;
		if (MYSQL.equals(businessConfig.getDataAdapter())) {
			adapter = new MysqlAdapter(businessConfig.getMysqlDataAdapterProperties(), null);
		} else if (POSTGRESQL.equals(businessConfig.getDataAdapter())) {
			adapter = new PostgreAdapter(businessConfig.getPgsqlDataAdapterProperties(), null);
		} else if (ORACLE.equals(businessConfig.getDataAdapter())) {
			adapter = new OracleAdapter(businessConfig.getOracleDataAdapterProperties(), null);
		} else if (SQL_SERVER.equals(businessConfig.getDataAdapter())) {
			adapter = new SqlServerAdapter(businessConfig.getSqlServerDataAdapterProperties(), null);
		} else if (DB2.equals(businessConfig.getDataAdapter())) {
			adapter = new Db2Adapter(businessConfig.getDb2DataAdapterProperties(), null);
		} else if (DM.equals(businessConfig.getDataAdapter())) {
			adapter = new DmAdapter(businessConfig.getDmDataAdapterProperties(), null);
		} else if (GAUSSDB.equals(businessConfig.getDataAdapter())) {
			adapter = new GaussDBAdapter(businessConfig.getGaussDBDataAdapterProperties(), null);
		} else if (DUCKDB.equals(businessConfig.getDataAdapter())) {
			adapter = new DuckDBAdapter(businessConfig.getDuckDBDataAdapterProperties(), null);
		} else {
			adapter = new M3Adapter(null, null);
		}
		return adapter;
	}
	
}
