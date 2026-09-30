		5.2.6  relationship indicates that a certain relationship must be satisfied between objects; it is a list structure, and relationships not listed in `relationship type` must not be used. Each element in the list describes

		- the relationship requirement between two objects; each relationship requirement consists of from, to, type, min_hops and max_hops
		- from must be the idx value of the class at the start of the relationship described in `relationship type`, and to must be the idx value of the class at the end of the relationship described in `relationship type`
		- type is a list structure that refers to the list of relationship names between two types of objects; the ["*"] wildcard represents all relationships
		- min_hops represents how many hops of relationship exist at least, and it can currently only be set to 1
		- max_hops represents the maximum number of hops of relationship to query, and -1 means unlimited
		- When the list of relationship is empty, the relationship item may be omitted.
