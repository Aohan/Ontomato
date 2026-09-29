			5.2.5.3 vector represents a vector query; if filtering is performed on a vector type field of an object, it can only be defined here, and it is not allowed to perform group by or having on it in a temporary table. It consists of one attribute properties, and the properties object consists of operator and the and/or attributes

				5.2.5.3.1 The value of the operator attribute is "logic"

				5.2.5.3.2 When the constraints are in an `AND` relationship, the and attribute is required, and the and attribute is an array

				5.2.5.3.3 When the constraints are in an `OR` relationship, the or attribute is required, and the or attribute is an array

				5.2.5.3.4 A single object in the array corresponding to the and or or attribute consists of the field and query attributes

					5.2.5.3.4.1 field (required) represents the name of the vector type field in the class

					5.2.5.3.4.2 query (required) represents the text to be queried
