			5.2.5.3 vector表示向量查询，如果对对象的vector类型字段做过滤的话，只能在这里定义，不允许在临时表中对它做group by或者having。它由一个属性properties组成，properties对象由operator和and/or属性组成

				5.2.5.3.1 operator属性的值是"logic"

				5.2.5.3.2 当约束条件间是`AND`逻辑时，需要有and属性，and属性是一个数组

				5.2.5.3.3 当约束条件间是`OR`逻辑时，需要有or属性，or属性是一个数组

				5.2.5.3.4 and或or属性对应的数组中的单个对象由field、query属性组成

					5.2.5.3.4.1 field（必填）代表类中的vector类型字段名

					5.2.5.3.4.2 query（必填）代表要查询的文字
