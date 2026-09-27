		6.3.4 vector类型字段输出至少需要两个step，在查询step中把该字段输出到临时表中（需要as、variable、field属性），在后面的step中从临时表输出（由as、variable、field、query属性组成）
   
			6.3.4.1 如果后面的step中该字段只有as、variable、field属性，代表输出该字段的全部的向量对应的文件
   
			6.3.4.2 如果后面的step中该字段有as、variable、field、query属性时，代表输出该字段按query中文字内容过滤后的向量对应的文件
			
		- 不允许对在output中对vector类型字段做group by和having操作
		- 不允许对在output中对vector类型字段做sort操作
