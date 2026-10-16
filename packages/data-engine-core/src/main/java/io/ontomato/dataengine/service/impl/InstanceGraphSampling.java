package io.ontomato.dataengine.service.impl;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;

/** A fixed overview budget apportioned by instance counts using largest remainders. */
final class InstanceGraphSampling {
    static final int NODE_LIMIT = 500;

    private InstanceGraphSampling() {}

    static Map<String, Integer> quotas(Map<String, Long> counts) {
        BigInteger total = counts.values().stream().map(BigInteger::valueOf)
                .reduce(BigInteger.ZERO, BigInteger::add);
        Map<String, Integer> quotas = new LinkedHashMap<>();
        if (total.compareTo(BigInteger.valueOf(NODE_LIMIT)) <= 0) {
            counts.forEach((name, count) -> quotas.put(name, count.intValue()));
            return quotas;
        }
        Map<String, BigInteger> remainders = new LinkedHashMap<>();
        counts.forEach((name, count) -> {
            BigInteger[] share = BigInteger.valueOf(count).multiply(BigInteger.valueOf(NODE_LIMIT))
                    .divideAndRemainder(total);
            quotas.put(name, share[0].intValue());
            remainders.put(name, share[1]);
        });
        var ranked = new ArrayList<>(counts.keySet());
        ranked.sort(Comparator.<String, BigInteger>comparing(remainders::get).reversed()
                .thenComparing(Comparator.naturalOrder()));
        int remaining = NODE_LIMIT - quotas.values().stream().mapToInt(Integer::intValue).sum();
        for (int i = 0; i < remaining; i++) quotas.merge(ranked.get(i), 1, Integer::sum);
        return quotas;
    }
}
