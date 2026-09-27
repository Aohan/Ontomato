1. 每个问题用一个 JSON 对象表示，包含两个属性：problem（问题文本）和 answer（查询计划）。

2. problem属性的值是提问的问题

3. answer 是包含 steps 数组的对象。按顺序执行这些步骤；只有一步查询时，steps 仍然是只含一个步骤对象的数组。

4. 每个单步查询，由graph 和 output 对象组成，graph描述查询规则，output描述查询的输出结果。

5. graph查询规则，包括patterns的list结构和pattern_logic

	5.1 patterns的list结构描述查询条件，pattern_logic表示多个patterns间的and或者or的逻辑关系

	5.2 patterns是一个list结构，描述多个查询条件，每个查询条件由objects、{$replace_relationship_key}组成。

		5.2.1 objects是list结构，表示类对象的查询条件，每个类的查询条件是一个object的json结构，由idx、variable、class、conditions组成

		5.2.2 idx是objects list内的顺序id，每个类的查询条件顺序id不可重复

		5.2.3 variable是存储这个类查询结果的变量名

		5.2.4 class是指从哪个类中查询符合条件的对象

		5.2.5 conditions表示查询条件，由properties、{$replace_text_key}{$replace_vector_key}{$replace_timeseries_key}组成，多条件类型共存时为`AND`逻辑.如果没有条件conditions可省略，properties、{$replace_text_key}{$replace_vector_key}{$replace_timeseries_key}中有一项时，conditions不可省略，未设置的查询条件视为无条件约束.

			5.2.5.1 properties表示类属性的查询条件，可以由多个属性条件或单个属性条件组成。当是单属性条件时，由field、operator、value组成，field表示属性名，operator表示逻辑运算符，包括“=”、“!=”、“>”、“>=”、“<”、“<=”、“between”、“like”、“in”、“is”、“is not”，value表示逻辑运算的值，当operator是between时value是一个二元数组，当operator是in时value是一个多元数组，当operator是is或is not时value是null。当由多个属性组成时，由 "operator": "logic"字段表示，且 多个属性由 "and"/"or"/"not" 字段的list结构表示，list结构内就是多个单属性条件。

{$replace_text_main_rule}

{$replace_vector_main_rule}

{$replace_timeseries_where_rule}

{$replace_relationship_main_rule}

	5.3 pattern_logic表示patterns的list元素内每个条件间的逻辑关系，可以设为 and或者or

6. output输出结果描述，由to_user、fields、{$replace_cStep_save_table_key}{$replace_cStep_sort_key}{$replace_cStep_limit_key}{$replace_cStep_group_by_key}组成

	6.1 to_user的值，true表示这个step的查询结果直接输出给用户，false表示存到临时表作为下一个step的参数

{$replace_cStep_save_table_rule}

	6.3 fields表示输出的字段列表，list结构，每个字段由variable、field{$replace_cStep_four_basic_math_key}、as、{$replace_cStep_function_key}{$replace_cStep_select_distinct_key}组成， variable表示取objects中哪个对象的variable，field表示取variable对象中的哪个属性，as表示输出转为的别名，{$replace_cStep_select_distinct_rule}
   
		6.3.1 如果非bucket类型字段不需要分组汇聚操作时，可直接输出

{$replace_cStep_group_by_rule}

{$replace_cStep_four_basic_math_rule}

{$replace_vector_output_rule}

{$replace_timeseries_output_rule}

{$replace_cStep_sort_rule}

{$replace_cStep_limit_rule}

{$replace_cStep_group_by_having_rule}

{$replace_cStep_other_rule}
