package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import io.ontomato.dataengine.service.UntitledKnowledgeTitlePrefix;

class OssKnowledgeTitleAssemblyTest {

    @Test
    void ossSuppliesTheEnglishUntitledPrefix() {
        try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext(OssKnowledgeTitleAssembly.class)) {
            assertEquals("Business knowledge ", ctx.getBean(UntitledKnowledgeTitlePrefix.class).prefix());
        }
    }
}
