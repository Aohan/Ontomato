	6.6 group_by表示分组统计，由fields和having组成.

    - fields是list结构，每个field由variable，field组成，variable表示被分组的对象变量，field表示类查询对象结果的属性字段
    - having是个list结构，表示对group_by后的筛选操作，list中每个筛选条件由variable、field、function、distinct（非必需）、operator和value，variable表示参与筛选的类查询对象结果，field表示类查询对象结果的属性字段，function表示对类查询对象结果的属性字段的计算，只能用avg取平均,count计数,min取最小,max取最大,sum求加和，***禁止使用其它聚合函数***。distinct表示是否对field属性做去重操作，它的值对应true/false。聚合函数作用于分组后数据，operator表示逻辑运算符，包括“=”、“!=”、“>”、“>=”、“<”、“<=”,value表示逻辑运算的值
