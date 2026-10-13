package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The two engines this module serves. They share the REST search subset this adapter uses;
 * they differ in the point-in-time API and in the accelerators each one offers. The dialect
 * is the single switch that keeps one implementation covering both.
 */
public enum EsDialect {

	ELASTICSEARCH("elasticsearch", "Elasticsearch"),
	OPENSEARCH("opensearch", "OpenSearch");

	private final String type;
	private final String label;

	EsDialect(String type, String label) {
		this.type = type;
		this.label = label;
	}

	public String type() {
		return type;
	}

	public String label() {
		return label;
	}

	public String openPitPath(String index) {
		return switch (this) {
			case ELASTICSEARCH -> "/" + index + "/_pit";
			case OPENSEARCH -> "/" + index + "/_search/point_in_time";
		};
	}

	public String parsePitId(JSONObject response) {
		return switch (this) {
			case ELASTICSEARCH -> response.getString("id");
			case OPENSEARCH -> response.getString("pit_id");
		};
	}

	public String closePitPath() {
		return switch (this) {
			case ELASTICSEARCH -> "/_pit";
			case OPENSEARCH -> "/_search/point_in_time";
		};
	}

	public String closePitBody(String id) {
		return switch (this) {
			case ELASTICSEARCH -> new JSONObject(Map.of("id", id)).toJSONString();
			case OPENSEARCH -> new JSONObject(Map.of("pit_id", List.of(id))).toJSONString();
		};
	}

	/**
	 * The search_after tiebreaker. Elasticsearch orders by {@code _shard_doc}; OpenSearch rejects
	 * it before 3.3, so it orders by the class primary key field the caller resolved, which must be
	 * a sortable keyword field to stay a unique cursor across shards.
	 */
	public JSONArray pitSort(String openSearchSortField) {
		return switch (this) {
			case ELASTICSEARCH -> JSONArray.of(new JSONObject(Map.of("_shard_doc", "asc")));
			case OPENSEARCH -> JSONArray.of(new JSONObject(Map.of(openSearchSortField, "asc")));
		};
	}
}
