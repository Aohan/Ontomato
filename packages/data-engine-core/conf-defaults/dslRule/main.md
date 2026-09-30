1. Represent each question as one JSON object with two properties: problem (the question text) and answer (the query plan).

2. The value of the problem attribute is the question asked

3. answer is an object containing a steps array. Execute the steps in order; a single-step query still uses an array containing one step object.

4. Each single-step query consists of a graph and an output object; graph describes the query rules and output describes the output result of the query.

5. The graph query rules include the list structure of patterns and pattern_logic

	5.1 The list structure of patterns describes the query conditions; pattern_logic represents the and/or logical relationship between multiple patterns

	5.2 patterns is a list structure that describes multiple query conditions; each query condition consists of objects, {$replace_relationship_key}.

		5.2.1 objects is a list structure that represents the query conditions of class objects; the query condition of each class is a json structure of an object, consisting of idx, variable, class and conditions

		5.2.2 idx is the sequential id within the objects list; the sequential id of the query condition of each class must not be duplicated

		5.2.3 variable is the variable name that stores the query result of this class

		5.2.4 class specifies from which class the objects matching the conditions are queried

		5.2.5 conditions represents the query conditions and consists of properties, {$replace_text_key}{$replace_vector_key}{$replace_timeseries_key}and when multiple condition types coexist the logic is `AND`. If there are no conditions, conditions may be omitted; when one of properties, {$replace_text_key}{$replace_vector_key}{$replace_timeseries_key}is present, conditions must not be omitted, and a query condition type that is not set is regarded as having no constraint.

			5.2.5.1 properties represents the query conditions of class attributes and may consist of multiple attribute conditions or a single attribute condition. For a single attribute condition it consists of field, operator and value; field is the attribute name, operator is the logical operator, including "=", "!=", ">", ">=", "<", "<=", "between", "like", "in", "is" and "is not", and value is the value of the logical operation. When operator is between, value is a two-element array; when operator is in, value is a multi-element array; when operator is is or is not, value is null. When it consists of multiple attributes, it is represented by the "operator": "logic" field, and the multiple attributes are represented by the list structure of the "and"/"or"/"not" fields; inside the list structure are multiple single-attribute conditions.

{$replace_text_main_rule}

{$replace_vector_main_rule}

{$replace_timeseries_where_rule}

{$replace_relationship_main_rule}

	5.3 pattern_logic represents the logical relationship between each condition within the list elements of patterns, and can be set to and or or

6. output describes the output result and consists of to_user, fields, {$replace_cStep_save_table_key}{$replace_cStep_sort_key}{$replace_cStep_limit_key}{$replace_cStep_group_by_key}

	6.1 The value of to_user: true means the query result of this step is output directly to the user, and false means it is stored in a temporary table as the parameter of the next step

{$replace_cStep_save_table_rule}

	6.3 fields represents the output field list, a list structure; each field consists of variable, field{$replace_cStep_four_basic_math_key}, as, {$replace_cStep_function_key}{$replace_cStep_select_distinct_key}variable specifies which object variable in objects to take, field specifies which attribute of the variable object to take, as is the alias the output is converted to, {$replace_cStep_select_distinct_rule}
   
		6.3.1 If a non-bucket type field does not need a group aggregation operation, it can be output directly

{$replace_cStep_group_by_rule}

{$replace_cStep_four_basic_math_rule}

{$replace_vector_output_rule}

{$replace_timeseries_output_rule}

{$replace_cStep_sort_rule}

{$replace_cStep_limit_rule}

{$replace_cStep_group_by_having_rule}

{$replace_cStep_other_rule}
