package io.ontomato.dataengine.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;

/**
 * The report's problem 7 shape: a model emits the {@code asGroupBy}/{@code statCal} flags as strings
 * or numbers. A bare {@code (Boolean)} cast threw on {@code "true"} and the error did not name the
 * field, so the caller could not tell which entry was wrong.
 */
class ABCProgrammerSkillToolsTest {

	@Test
	void acceptsRealBooleans() {
		assertTrue(ABCProgrammerSkillTools.asBoolean(Boolean.TRUE, "asGroupBy", 0));
		assertFalse(ABCProgrammerSkillTools.asBoolean(Boolean.FALSE, "asGroupBy", 0));
	}

	@Test
	void acceptsTheStringAndNumberFormsAModelEmits() {
		assertTrue(ABCProgrammerSkillTools.asBoolean("true", "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean("TRUE", "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean(" true ", "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean("yes", "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean("1", "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean(1, "statCal", 1));
		assertTrue(ABCProgrammerSkillTools.asBoolean(1.0d, "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean("false", "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean("NO", "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean("0", "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean("", "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean(0, "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean(0.0d, "statCal", 1));
		assertFalse(ABCProgrammerSkillTools.asBoolean(null, "statCal", 1));
	}

	@Test
	void namesTheOffendingFieldWhenTheValueIsNotAFlag() {
		IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
				() -> ABCProgrammerSkillTools.asBoolean("maybe", "asGroupBy", 3));
		assertTrue(e.getMessage().contains("outputKeyRefs[3].asGroupBy"), e.getMessage());
		assertTrue(e.getMessage().contains("maybe"), e.getMessage());

		// The same located failure applies to the other flag, so either one can be fixed precisely.
		IllegalArgumentException other = assertThrows(IllegalArgumentException.class,
				() -> ABCProgrammerSkillTools.asBoolean("n/a", "statCal", 0));
		assertTrue(other.getMessage().contains("outputKeyRefs[0].statCal"), other.getMessage());
	}

	/** The exact call site: a "true"/1 flag from the model maps onto the typed reference. */
	@Test
	void mapsAKeyRefWhoseFlagsAreStringsOrNumbers() {
		Map<String, Object> colRef = new HashMap<>();
		colRef.put("key", "person_name");
		colRef.put("className", "person");
		colRef.put("attrName", "name");
		colRef.put("asGroupBy", "true");
		colRef.put("statCal", 1);

		ABCHarnessProgramOutKeyRef okr = ABCProgrammerSkillTools.applyOutKeyRef(colRef, 0, List.of());
		assertEquals("person_name", okr.getKey());
		assertEquals("person", okr.getClassName());
		assertEquals("name", okr.getAttrName());
		assertTrue(okr.getAsGroupBy());
		assertTrue(okr.getStatCal());
	}

	@Test
	void theKeyRefMappingNamesTheOffendingEntry() {
		Map<String, Object> colRef = new HashMap<>();
		colRef.put("key", "k");
		colRef.put("className", "person");
		colRef.put("attrName", "name");
		colRef.put("asGroupBy", "maybe");

		IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
				() -> ABCProgrammerSkillTools.applyOutKeyRef(colRef, 2, List.of()));
		assertTrue(e.getMessage().contains("outputKeyRefs[2].asGroupBy"), e.getMessage());
	}
}
