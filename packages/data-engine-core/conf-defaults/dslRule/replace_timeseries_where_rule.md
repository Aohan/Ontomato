			5.2.5.4 timeseries represents a time series query; if filtering is performed on a bucket type field of an object, it can only be defined here, and it is not allowed to perform group by or having on it in a temporary table. It consists of one attribute properties, and the properties object consists of operator and the and/or attributes

				5.2.5.4.1 The value of the operator attribute is "logic"

				5.2.5.4.2 When the constraints are in an `AND` relationship, the and attribute is required, and the and attribute is an array

				5.2.5.4.3 When the constraints are in an `OR` relationship, the or attribute is required, and the or attribute is an array

				5.2.5.4.4 A single object in the array corresponding to the and or or attribute consists of the field, time_range, conditions and asserts attributes

					5.2.5.4.4.1 field (required) represents the name of the bucket type field in the class

					5.2.5.4.4.2 time_range (required) is an object containing two attributes start and end, which represent the time range of the time series values to be delimited; the time format is `yyyy-MM-dd HH:mm:ss`, start must have a concrete value, and the value of end may be an empty string (meaning up to the current time)

					5.2.5.4.4.3 conditions (may be an empty array) is an array that represents the filter conditions of the time series values; the conditions in the array are in an `AND` relationship, and a single object in the array consists of metric, operator and value

						5.2.5.4.4.3.1 When metric is name, operator can only be one of "=", "like" and "in"

							5.2.5.4.4.3.1.1 When operator is "=", value is a string, representing exact filtering by sub-metric name
							5.2.5.4.4.3.1.2 When operator is "like", value is a string, representing fuzzy filtering by sub-metric name
							5.2.5.4.4.3.1.3 When operator is "in", value is a string array, representing filtering by sub-metric name within the array range

						5.2.5.4.4.3.2 When metric is value, operator can only be one of "=", ">", "<", ">=" and "<=", representing filtering by time series value, and the value of value is an integer or a float

					5.2.5.4.4.4 asserts (required) is an array and must not be an empty array, and asserts can only be used in step1. It represents the values obtained after performing several time-dimension aggregation calculations on the time series dataset filtered according to 5.2.5.4.4.1, 5.2.5.4.4.2 and 5.2.5.4.4.3, and then performing numeric expression judgments; the expression judgments in the array are in an `AND` relationship, and a single object in the array consists of function, interval, operator and value

						5.2.5.4.4.4.1 function is the aggregation function, and the available function range is "avg", "sum", "max" and "min"

						5.2.5.4.4.4.2 interval is the time granularity of the aggregation; it is a string consisting of a numeric part and a time unit part, the numeric part is a positive integer, and the time unit part is "m" (minute), "h" (hour), "d" (day), "w" (week), "M" (month) or "y" (year), for example aggregating by two hours is "2h"

						5.2.5.4.4.4.3 operator can only be one of "=", ">", "<", ">=" and "<="

						5.2.5.4.4.4.4 The value of value is an integer or a float
