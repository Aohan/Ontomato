		5.2.6  relationship表示objects之间必须满足某种关系，是个list结构，没有在`关系类型` 中列出的关系不允许使用，list中每个元素描述了

		- 两个object之间的关系要求，每个关系要求由from、to、type、min_hops、max_hops组成
		- from必须是`关系类型`中描述的关系起点的类的idx值，to必须是`关系类型`中描述的关系终点的类的idx值
		- type是个list结构，指两类对象间的关系名称列表，["*"]通配符表示所有关系
		- min_hops表示至少存在几跳关系，目前只能设为1
		- max_hops表示最大查询几跳关系，-1表示不限制
		- relationship的list是空时，relationship这项可以省略。
