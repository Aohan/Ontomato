		6.3.2 If a non-bucket type field needs a group aggregation operation, the aggregation operation must be defined according to the following logic
   
		- When there is a function field, it indicates that an aggregate calculation is needed on this attribute field; the aggregate calculation supports avg for the average, count for counting, min for the minimum, max for the maximum and sum for summation, and it aggregates the entire result set

		- When there is a function aggregate calculation, it needs to be in a different step from the query, that is, the function aggregate calculation is required to act only on the fields of the temporary table
