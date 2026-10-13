package io.ontomato.dataengine.dataAdapter;

import java.io.IOException;

import org.apache.http.entity.ContentType;
import org.apache.http.nio.entity.NStringEntity;
import org.apache.http.util.EntityUtils;
import org.elasticsearch.client.Request;
import org.elasticsearch.client.Response;
import org.elasticsearch.client.ResponseException;
import org.elasticsearch.client.RestClient;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * One engine connection: auth + HTTP + JSON.
 *
 * <p>Auth follows the engines' common standard: when a user is configured, every request
 * carries an HTTP Basic credential; with no user configured, no {@code Authorization} header
 * is sent at all, so a cluster with security disabled works out of the box.</p>
 */
public class EsHttp implements AutoCloseable {

	private final RestClient client;

	public EsHttp(DataAdapterConnection connection) {
		String url = connection == null ? null : connection.getUrl();
		if (url == null || url.isBlank()) {
			throw new IllegalArgumentException("The data source URL is required");
		}
		java.net.URI uri;
		try {
			uri = java.net.URI.create(url.trim());
		} catch (RuntimeException e) {
			throw new IllegalArgumentException("Invalid data source URL: " + url);
		}
		String scheme = uri.getScheme() == null ? "http" : uri.getScheme();
		String host = uri.getHost();
		if (host == null) {
			throw new IllegalArgumentException("The data source URL has no host: " + url);
		}
		int port = uri.getPort() >= 0 ? uri.getPort() : ("https".equalsIgnoreCase(scheme) ? 443 : 9200);
		String user = connection.getUser();
		String password = connection.getPassword();
		this.client = RestClient.builder(new org.apache.http.HttpHost(host, port, scheme))
				.setHttpClientConfigCallback(httpClient -> {
					if (user != null && !user.isBlank()) {
						org.apache.http.client.CredentialsProvider credentials =
								new org.apache.http.impl.client.BasicCredentialsProvider();
						credentials.setCredentials(org.apache.http.auth.AuthScope.ANY,
								new org.apache.http.auth.UsernamePasswordCredentials(user, password == null ? "" : password));
						httpClient.setDefaultCredentialsProvider(credentials);
					}
					return httpClient;
				})
				.build();
	}

	public JSONObject get(String endpoint, java.util.Map<String, String> params) throws Exception {
		return object(requestText("GET", endpoint, null, params));
	}

	public JSONArray getArray(String endpoint, java.util.Map<String, String> params) throws Exception {
		String text = requestText("GET", endpoint, null, params);
		return text == null || text.isBlank() ? new JSONArray() : JSON.parseArray(text);
	}

	public JSONObject post(String endpoint, JSONObject body) throws Exception {
		return object(requestText("POST", endpoint, body == null ? null : body.toJSONString(), null));
	}

	public JSONObject post(String endpoint, JSONObject body, java.util.Map<String, String> params) throws Exception {
		return object(requestText("POST", endpoint, body == null ? null : body.toJSONString(), params));
	}

	public JSONObject put(String endpoint, JSONObject body) throws Exception {
		return object(requestText("PUT", endpoint, body == null ? null : body.toJSONString(), null));
	}

	public JSONObject delete(String endpoint) throws Exception {
		return object(requestText("DELETE", endpoint, null, null));
	}

	public JSONObject request(String method, String endpoint, String jsonBody, java.util.Map<String, String> params) throws Exception {
		return object(requestText(method, endpoint, jsonBody, params));
	}

	private JSONObject object(String text) {
		return text == null || text.isBlank() ? new JSONObject() : JSON.parseObject(text);
	}

	private String requestText(String method, String endpoint, String jsonBody, java.util.Map<String, String> params)
			throws Exception {
		Request request = new Request(method, endpoint.startsWith("/") ? endpoint : "/" + endpoint);
		if (params != null) {
			params.forEach(request::addParameter);
		}
		if (jsonBody != null) {
			request.setEntity(new NStringEntity(jsonBody, ContentType.APPLICATION_JSON));
		}
		try {
			Response response = client.performRequest(request);
			return response.getEntity() == null ? "" : EntityUtils.toString(response.getEntity());
		} catch (ResponseException e) {
			String body = e.getResponse() == null || e.getResponse().getEntity() == null ? ""
					: EntityUtils.toString(e.getResponse().getEntity());
			throw new IOException("HTTP " + e.getResponse().getStatusLine().getStatusCode()
					+ " on " + method + " " + endpoint + ": " + body, e);
		}
	}

	@Override
	public void close() {
		try {
			client.close();
		} catch (Exception ignored) {
			// best effort
		}
	}
}
