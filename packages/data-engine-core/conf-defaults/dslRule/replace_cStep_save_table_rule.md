	6.2 save_table表示存储的临时表名，要以`/`开头，第二个字符为字母，后面字符没有要求，长度不超过64个字符. 当to_user为false时起作用，to_user为true时，不需要这项，

	在DSL中，临时表只能作为同一个DSL对象单次执行中的中间结果引用。产生临时表的step和引用该临时表的step必须放在同一个DSL对象的steps中，并通过一次executeDsl调用整体执行。严禁先用一次executeDsl调用“保存”临时表，再在另一个DSL或另一次executeDsl调用中引用它。
