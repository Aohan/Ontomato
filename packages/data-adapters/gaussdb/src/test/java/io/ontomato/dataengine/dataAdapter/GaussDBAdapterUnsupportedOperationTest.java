package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

class GaussDBAdapterUnsupportedOperationTest {

	private final GaussDBAdapter adapter = new GaussDBAdapter(null, null);

	@Test
	void unsupportedOperationsThrow() {
		assertThrowsUnsupported(() -> adapter.createNamespace("ns"), "createNamespace");
		assertThrowsUnsupported(() -> adapter.truncateNamespace("ns"), "truncateNamespace");
		assertThrowsUnsupported(() -> adapter.dropNamespace("ns"), "dropNamespace");
		assertThrowsUnsupported(() -> adapter.createClass("ns", Map.of()), "createClass");
		assertThrowsUnsupported(() -> adapter.createEdgeType("ns", "edge"), "createEdgeType");
		assertThrowsUnsupported(() -> adapter.insertObjects("ns", Map.of(), new JSONArray()), "insertObjects");
		assertThrowsUnsupported(() -> adapter.updateObjects("ns", Map.of(), new JSONObject(), new JSONObject()), "updateObjects");
		assertThrowsUnsupported(() -> adapter.deleteObjects("ns", Map.of(), new JSONObject()), "deleteObjects");
		assertThrowsUnsupported(() -> adapter.createEdge("ns", "rel", "c1", "o1", "c2", "o2"), "createEdge");
		assertThrowsUnsupported(() -> adapter.deleteEdge("ns", "rel", "c1", "o1", "c2", "o2"), "deleteEdge");
		assertThrowsUnsupported(() -> adapter.query(new JSONObject(), "s", "d", null, null), "query");
	}

	private void assertThrowsUnsupported(org.junit.jupiter.api.function.Executable exec, String op) {
		UnsupportedDataAdapterOperationException ex = assertThrows(UnsupportedDataAdapterOperationException.class, exec);
		assertEquals("GaussDB data source does not support " + op, ex.getMessage());
	}
}
