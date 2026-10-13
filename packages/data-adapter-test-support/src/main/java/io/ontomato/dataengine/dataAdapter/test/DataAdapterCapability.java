package io.ontomato.dataengine.dataAdapter.test;

import java.util.EnumSet;
import java.util.Set;

/**
 * The operations a {@code DataAdapter} implementation actually supports.
 *
 * <p>Adapters are not uniform: object-graph adapters such as PostgreSQL and DuckDB
 * implement the full object-graph write path, while read-only relational adapters
 * such as MySQL, GaussDB, and SQLServer only translate DSL to SQL against existing
 * tables and throw {@code UnsupportedDataAdapterOperationException} for the rest.
 * A concrete test declares the capabilities its adapter supports; the shared suite
 * skips every test gated on a capability the adapter does not have.</p>
 */
public enum DataAdapterCapability {

	/** {@code openConnection()} / {@code testConnection()} against a real JDBC source. */
	JDBC_CONNECTION,

	/** {@code executeDsl()} translates a DSL query to SQL and runs it. */
	READ_QUERY,

	/** {@code getSampleDataFileName()} / {@code querySampleDataByClassName()}. */
	SAMPLE_DATA,

	/** {@code createNamespace()} / {@code truncateNamespace()} / {@code dropNamespace()}. */
	NAMESPACE_LIFECYCLE,

	/** {@code createClass()} (and {@code createEdgeType()} when meaningful). */
	CLASS_SCHEMA,

	/** {@code insertObjects()} / {@code updateObjects()} / {@code deleteObjects()}. */
	OBJECT_CRUD,

	/** {@code createEdge()} / {@code deleteEdge()}. */
	EDGE_CRUD,

	/**
	 * Edges are real relationships, not a key field stored on one side. A relationship-edge
	 * adapter materializes its seed edges through {@code createEdge()} (there is no key field in
	 * the seed data to imply them), and the edge tests assert connectivity through the read path
	 * instead of a foreign-key column. Adapters without this capability keep the key-field
	 * semantics and are unaffected.
	 */
	RELATIONSHIP_EDGES,

	/** {@code query()} — the object-graph query path. */
	GRAPH_QUERY,

	/** {@code queryVectorAttr()} reads a vector attribute's current value. */
	VECTOR_ATTR;

	/**
	 * The full write path with key-field edges — what object-graph adapters such as
	 * PostgreSQL/DuckDB support. It deliberately excludes {@link #RELATIONSHIP_EDGES}, whose
	 * representation is the opposite one.
	 */
	public static final Set<DataAdapterCapability> FULL = EnumSet.of(
			JDBC_CONNECTION, READ_QUERY, SAMPLE_DATA, NAMESPACE_LIFECYCLE, CLASS_SCHEMA, OBJECT_CRUD,
			EDGE_CRUD, GRAPH_QUERY, VECTOR_ATTR);

	/** The read-only relational path — what the query-only SQL adapters support. */
	public static final Set<DataAdapterCapability> READ_ONLY = EnumSet.of(
			JDBC_CONNECTION, READ_QUERY, SAMPLE_DATA);
}
