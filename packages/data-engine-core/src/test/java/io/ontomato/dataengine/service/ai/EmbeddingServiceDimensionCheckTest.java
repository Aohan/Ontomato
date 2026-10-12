package io.ontomato.dataengine.service.ai;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * The embedding test (confirmed item 6) compares the returned length against the draft dimensions
 * and reports both numbers on mismatch.
 */
class EmbeddingServiceDimensionCheckTest {

    @Test
    void matchingLengthPasses() {
        assertDoesNotThrow(() -> EmbeddingService.checkReturnedDimension(2048, 2048));
    }

    @Test
    void mismatchReportsRequestedAndActualLengths() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> EmbeddingService.checkReturnedDimension(2048, 4096));
        assertTrue(error.getMessage().contains("4096"), error.getMessage());
        assertTrue(error.getMessage().contains("2048"), error.getMessage());
    }

}
