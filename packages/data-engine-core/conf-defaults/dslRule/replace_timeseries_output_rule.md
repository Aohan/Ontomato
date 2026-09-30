		6.3.5 The output of a bucket type field requires at least two steps; in the query step the field is output to a temporary table (the as, variable and field attributes are required). If no aggregation operation is needed, it is output from the temporary table in the following step (consisting of the as, variable, field, time_range and conditions attributes)
   
			6.3.5.1 If in the following step the field has only the as, variable and field attributes, it means outputting all the time series data of the field
   
			6.3.5.2 If in the following step the field has the as, variable, field and time_range attributes, it means outputting the time series data of the field filtered by time range

			- time_range is an object containing two attributes start and end, which represent the time range of the time series values to be delimited; the time format is `yyyy-MM-dd HH:mm:ss`, start must have a concrete value, and the value of end may be an empty string (meaning up to the current time)
   
			6.3.5.3 If in the following step the field has the as, variable, field, time_range and conditions attributes, it means outputting the time series data of the field filtered by time range and by attributes inside the time series

				6.3.5.3.1 conditions (may be an empty array) is an array that represents the filter conditions of the time series values; the conditions in the array are in an `AND` relationship, and a single object in the array consists of metric, operator and value

					6.3.5.3.1.1 When metric is name, operator can only be one of "=", "like" and "in"

					- When operator is "=", value is a string, representing exact filtering by sub-metric name
					- When operator is "like", value is a string, representing fuzzy filtering by sub-metric name
					- When operator is "in", value is a string array, representing filtering by sub-metric name within the array range

					6.3.5.3.1.2 When metric is value, operator can only be one of "=", ">", "<", ">=" and "<=", representing filtering by time series value, and the value of value is an integer or a float
   
		6.3.6 The output of a bucket type field requires at least two steps; in the query step the field is output to a temporary table (the as, variable and field attributes are required). If an aggregation operation is needed, it is output from the temporary table in the following step (consisting of the as, variable, field, time_range, conditions, function and interval attributes)

		- function is the aggregation function, and the available function range is "avg", "sum", "max" and "min"
        - It is not allowed to perform group by and having operations on Bucket type fields in output
        - It is not allowed to perform sort operations on Bucket type fields in output
		- interval is the time granularity of the aggregation; it is a string consisting of a numeric part and a time unit part, the numeric part is a positive integer, and the time unit part is "m" (minute), "h" (hour), "d" (day), "w" (week), "M" (month) or "y" (year), for example aggregating by one week is "1w"
        - The time series data output of a bucket type field outputs the timestamp, metric name, metric value and label of the time series data at the same time, so there is no need to output the timestamp and metric value separately
