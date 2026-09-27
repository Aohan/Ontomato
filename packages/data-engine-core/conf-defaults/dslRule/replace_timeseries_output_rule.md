		6.3.5 bucket类型字段输出至少需要两个step，在查询step中把该字段输出到临时表中（需要as、variable、field属性），如果不需要汇聚操作时，在后面的step中从临时表输出（由as、variable、field、time_range、conditions属性组成）
   
			6.3.5.1 如果后面的step中该字段只有as、variable、field属性，代表输出该字段的全部时序数据
   
			6.3.5.2 如果后面的step中该字段有as、variable、field、time_range属性时，代表输出该字段按时间范围过滤后的时序数据

			- time_range是一个对象，里面有两个属性start和end，它们代表需要圈定的时序值的时间范围，时间格式为`yyyy-MM-dd HH:mm:ss`，start必须有具体的值，end的值可以给空字符串（代表到当前时间）
   
			6.3.5.3 如果后面的step中该字段有as、variable、field、time_range、conditions属性时，代表输出该字段按时间范围过滤和时序内属性过滤后的时序数据

				6.3.5.3.1 conditions（可为空数组）是一个数组，它代表时序值的过滤条件，数组中各条件间是`AND`的关系，数组中单一对象由metric、operator、value组成

					6.3.5.3.1.1 当metric是name时，operator只能是“=”、“like”、“in”中的一个

					- operator是“=”时，value是字符串，代表按子指标名精确过滤
					- operator是“like”时，value是字符串，代表按子指标名模糊过滤
					- operator是“in”时，value是字符串数组，代表按子指标名在数组范围内过滤

					6.3.5.3.1.2 当metric是value时，operator只能是“=”、“>”、“<”、“>=”、“<=”中的一个，代表按时序值过滤，value的值是整型或浮点型
   
		6.3.6 bucket类型字段输出至少需要两个step，在查询step中把该字段输出到临时表中（需要as、variable、field属性），如果需要汇聚操作时，在后面的step中从临时表输出（由as、variable、field、time_range、conditions、function、interval属性组成）

		- function是汇聚函数，可选函数范围是“avg”、“sum”、“max”、“min”
        - 不允许对在output中对Bucket类型字段做group by和having操作
        - 不允许对在output中对Bucket类型字段做sort操作
		- interval是汇聚的时间颗粒度，它是一个字符串，由数字部分和时间单位部分组成，数字部分是正整数，时间单位部分是“m”（分钟）、“h”（小时）、“d”（天）、“w”（周）、“M”（月）、“y”（年），例如按一周汇聚是“1w”
        - bucket类型字段的时序数据输出会同时时序数据的时间戳、指标名称、指标值和标签，不用分别输出时间戳、指标值
