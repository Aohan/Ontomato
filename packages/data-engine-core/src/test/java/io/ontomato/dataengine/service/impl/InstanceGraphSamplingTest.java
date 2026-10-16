package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class InstanceGraphSamplingTest {
    @Test void keepsAllInstancesWithinBudgetIncludingEmptyClasses() {
        assertEquals(Map.of("A", 30, "B", 470, "Empty", 0),
                InstanceGraphSampling.quotas(Map.of("A", 30L, "B", 470L, "Empty", 0L)));
        assertEquals(Map.of(), InstanceGraphSampling.quotas(Map.of()));
    }

    @Test void allocatesByPopulationRatherThanEqualClassCaps() {
        assertEquals(Map.of("Places", 11, "Utterances", 489),
                InstanceGraphSampling.quotas(Map.of("Places", 235L, "Utterances", 10415L)));
        assertEquals(Map.of("A", 400, "B", 100),
                InstanceGraphSampling.quotas(Map.of("A", 8000L, "B", 2000L)));
        assertEquals(Map.of("Large", 500, "Tiny", 0),
                InstanceGraphSampling.quotas(Map.of("Large", 1000000L, "Tiny", 1L)));
    }

    @Test void usesLargestRemaindersWithStableClassNameTies() {
        assertEquals(Map.of("A", 167, "B", 167, "C", 166),
                InstanceGraphSampling.quotas(Map.of("C", 1000L, "B", 1000L, "A", 1000L)));
        var counts = new LinkedHashMap<String, Long>();
        for (int i = 0; i < 600; i++) counts.put("C" + i, 1L);
        var quotas = InstanceGraphSampling.quotas(counts);
        assertEquals(500, quotas.values().stream().mapToInt(Integer::intValue).sum());
        assertTrue(quotas.values().stream().allMatch(quota -> quota == 0 || quota == 1));
    }

    @Test void largeCountsDoNotOverflowDuringApportionment() {
        assertEquals(Map.of("A", 250, "B", 250),
                InstanceGraphSampling.quotas(Map.of("A", Long.MAX_VALUE, "B", Long.MAX_VALUE)));
    }
}
