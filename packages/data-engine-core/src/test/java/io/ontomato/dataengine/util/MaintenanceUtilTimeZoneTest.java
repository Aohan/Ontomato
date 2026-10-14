package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.TimeZone;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONObject;

/**
 * The monitoring timestamp carries the process time zone, which the deployment sets (UTC for the
 * open-source image, Asia/Shanghai for the enterprise image). The test moves the JVM default zone
 * instead of relying on the host's, and reads the offset back from the real JSON the endpoint serves.
 */
class MaintenanceUtilTimeZoneTest {

    @Test
    void collectAllStampsTheProcessTimeZone() {
        TimeZone previous = TimeZone.getDefault();
        try {
            assertEquals(ZoneOffset.UTC, collectStampOffset("UTC"));
            assertEquals(ZoneOffset.ofHours(8), collectStampOffset("Asia/Shanghai"));
        } finally {
            TimeZone.setDefault(previous);
        }
    }

    private static ZoneOffset collectStampOffset(String zoneId) {
        TimeZone.setDefault(TimeZone.getTimeZone(zoneId));
        JSONObject status = new MaintenanceUtil().collectAll();
        return OffsetDateTime.parse(status.getString("timestamp")).getOffset();
    }
}
