package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * A date/timestamp condition is a literal by default and only becomes epoch millis when the target
 * adapter asks for it (M3). The passthrough must not touch the value at all, and the conversion must
 * honour the adapter's time zone.
 */
class DslUtilTimeConditionTest {

	private static final List<Map<String, Object>> CLASS_DEFS = classDefs();

	@Test
	void literalModeLeavesTimeValuesVerbatim() {
		String dsl = dsl(cond("birthday", "=", "1992-03-03"));
		String out = DslUtil.setConditionTimeColumnToCorrectFormat(dsl, null, CLASS_DEFS, false, null);
		// Nothing about the value changes: a literal is compared against the column natively.
		assertEquals("1992-03-03", value(out, "properties", "value"));
	}

	@Test
	void literalModeLeavesTimestampBetweenAndInVerbatim() {
		String dsl = dsl(cond("created_at", "between", JSONArray.of("2020-01-01 10:00:00", "2020-02-02 11:00:00")));
		String between = DslUtil.setConditionTimeColumnToCorrectFormat(dsl, null, CLASS_DEFS, false, null);
		JSONArray b = (JSONArray) value(between, "properties", "value");
		assertEquals("2020-01-01 10:00:00", b.getString(0));
		assertEquals("2020-02-02 11:00:00", b.getString(1));

		String inDsl = dsl(cond("birthday", "in", JSONArray.of("1990-01-01", "1993-04-04")));
		String in = DslUtil.setConditionTimeColumnToCorrectFormat(inDsl, null, CLASS_DEFS, false, null);
		JSONArray l = (JSONArray) value(in, "properties", "value");
		assertEquals("1990-01-01", l.getString(0));
		assertEquals("1993-04-04", l.getString(1));
	}

	@Test
	void epochModeConvertsDateUsingTheGivenZone() {
		long utc = LocalDate.parse("1992-03-03").atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
		long shanghai = LocalDate.parse("1992-03-03").atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant()
				.toEpochMilli();
		assertNotEquals(utc, shanghai);

		String dsl = dsl(cond("birthday", "=", "1992-03-03"));
		assertEquals(utc, epoch(dsl, TimeZone.getTimeZone("UTC")));
		assertEquals(shanghai, epoch(dsl, TimeZone.getTimeZone("Asia/Shanghai")));
	}

	@Test
	void epochModeConvertsTimestampUsingTheGivenZone() {
		long utc = LocalDateTime.parse("2020-01-01T10:00:00").atZone(ZoneOffset.UTC).toInstant().toEpochMilli();
		long shanghai = LocalDateTime.parse("2020-01-01T10:00:00").atZone(ZoneId.of("Asia/Shanghai")).toInstant()
				.toEpochMilli();

		String dsl = dsl(cond("created_at", "between", JSONArray.of("2020-01-01 10:00:00", "2020-02-02 11:00:00")));
		String out = DslUtil.setConditionTimeColumnToCorrectFormat(dsl, null, CLASS_DEFS, true,
				TimeZone.getTimeZone("UTC"));
		JSONArray v = (JSONArray) value(out, "properties", "value");
		assertEquals(utc, v.getLong(0));
		assertEquals(LocalDateTime.parse("2020-02-02T11:00:00").atZone(ZoneOffset.UTC).toInstant().toEpochMilli(),
				v.getLong(1));

		String dsl2 = dsl(cond("created_at", "=", "2020-01-01 10:00:00"));
		String out2 = DslUtil.setConditionTimeColumnToCorrectFormat(dsl2, null, CLASS_DEFS, true,
				TimeZone.getTimeZone("Asia/Shanghai"));
		assertEquals(shanghai, Long.parseLong(value(out2, "properties", "value").toString()));
	}

	@Test
	void nonTimeFieldIsUntouchedInEpochMode() {
		String dsl = dsl(cond("name", "=", "Alice"));
		String out = DslUtil.setConditionTimeColumnToCorrectFormat(dsl, null, CLASS_DEFS, true,
				TimeZone.getTimeZone("UTC"));
		assertEquals("Alice", value(out, "properties", "value"));
	}

	@Test
	void nullFormatListUsesTheDefaultFormats() {
		String dsl = dsl(cond("birthday", "=", "1992-03-03"));
		long utc = LocalDate.parse("1992-03-03").atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
		assertEquals(utc, epoch(dsl, TimeZone.getTimeZone("UTC")));
	}

	// ----------------------------------------------------------------------------------

	private static long epoch(String dsl, TimeZone zone) {
		String out = DslUtil.setConditionTimeColumnToCorrectFormat(dsl, null, CLASS_DEFS, true, zone);
		return Long.parseLong(value(out, "properties", "value").toString());
	}

	private static String dsl(JSONObject condition) {
		JSONObject object = new JSONObject();
		object.put("class", "person");
		object.put("variable", "p");
		object.put("idx", 0);
		JSONObject conditions = new JSONObject();
		conditions.put("properties", condition);
		object.put("conditions", conditions);

		JSONObject pattern = new JSONObject();
		pattern.put("objects", JSONArray.of(object));

		JSONObject graph = new JSONObject();
		graph.put("patterns", JSONArray.of(pattern));

		JSONObject step = new JSONObject();
		step.put("graph", graph);

		JSONObject answer = new JSONObject();
		answer.put("steps", JSONArray.of(step));

		JSONObject dsl = new JSONObject();
		dsl.put("answer", answer);
		return JSONArray.of(dsl).toJSONString();
	}

	private static JSONObject cond(String field, String operator, Object value) {
		JSONObject c = new JSONObject();
		c.put("field", field);
		c.put("operator", operator);
		c.put("value", value);
		return c;
	}

	private static Object value(String dslStr, String block, String key) {
		JSONArray dsls = JSON.parseArray(dslStr);
		return dsls.getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0)
				.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects")
				.getJSONObject(0).getJSONObject("conditions").getJSONObject(block).get(key);
	}

	private static List<Map<String, Object>> classDefs() {
		Map<String, Object> person = new java.util.HashMap<>();
		person.put("className", "person");
		person.put("attrs", List.of(
				Map.of("name", "id", "type", "varchar"),
				Map.of("name", "name", "type", "varchar"),
				Map.of("name", "birthday", "type", "date"),
				Map.of("name", "created_at", "type", "timestamp")));
		return List.of(person);
	}
}
