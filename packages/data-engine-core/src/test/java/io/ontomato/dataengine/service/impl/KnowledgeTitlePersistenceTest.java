package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.UntitledKnowledgeTitlePrefix;

class KnowledgeTitlePersistenceTest {

    @Test
    void emptyTitlePersistsTheSuppliedPrefixAndTrimsTheId() {
        Inserted inserted = insert("Business knowledge ", null, "  id-1  ", "body");
        assertEquals("id-1", inserted.id);
        assertEquals("Business knowledge id-1", inserted.title);
        assertEquals("body", inserted.text);
        assertEquals(List.of("tag"), inserted.tags);
        assertEquals(0, inserted.creatorType);
        assertEquals(1, inserted.status);
        assertEquals("add: Business knowledge id-1", inserted.audit.getDescription());
        assertEquals(AuditLog.BUSSINESS_BKNOWLEDGE, inserted.audit.getBussiness());
        assertEquals(AuditLog.OPERATION_ADD, inserted.audit.getOperation());
        assertEquals(Boolean.FALSE, inserted.audit.getByAi());
        assertEquals("user-1", inserted.audit.getUserId());
    }

    @Test
    void blankTitlePersistsTheEnterprisePrefixAndGeneratesAnId() {
        Inserted inserted = insert("Business knowledge ", "", null, "text");
        assertTrue(inserted.id.startsWith("knowledge_"));
        assertEquals("Business knowledge " + inserted.id, inserted.title);
        assertEquals("add: " + inserted.title, inserted.audit.getDescription());
    }

    @Test
    void suppliedTitleIsStoredUnchanged() {
        Inserted inserted = insert("Business knowledge ", "  Named  ", "  id-2  ", "kept");
        assertEquals("id-2", inserted.id);
        assertEquals("  Named  ", inserted.title);
        assertEquals("kept", inserted.text);
    }

    private Inserted insert(String prefix, String title, String id, String text) {
        KnowledgeDao knowledgeDao = mock(KnowledgeDao.class);
        AuditLogDao auditLogDao = mock(AuditLogDao.class);
        BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
        LangService langService = mock(LangService.class);
        BusinessConfig config = new BusinessConfig();
        config.setLang("en");
        when(businessConfigService.get("domain-1")).thenReturn(config);
        when(langService.get("en", "AuditLog.businessKnowledge.add")).thenReturn("add");
        User user = mock(User.class);
        when(user.getDomainId()).thenReturn("domain-1");
        when(user.getId()).thenReturn("user-1");
        when(user.getUserName()).thenReturn("ada");

        KnowledgeServiceImpl service = new KnowledgeServiceImpl(new UntitledKnowledgeTitlePrefix(prefix));
        ReflectionTestUtils.setField(service, "knowledgeDao", knowledgeDao);
        ReflectionTestUtils.setField(service, "auditLogDao", auditLogDao);
        ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(service, "langService", langService);

        service.addBussinessKnowledge(id, title, text, 1, List.of("tag"), user);

        ArgumentCaptor<String> storedId = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> storedTitle = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> storedText = ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> storedTags = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<AuditLog> audit = ArgumentCaptor.forClass(AuditLog.class);
        InOrder order = inOrder(knowledgeDao, auditLogDao);
        order.verify(knowledgeDao).insertKnowledge(
                storedId.capture(), eq("domain-1"), storedTitle.capture(), storedText.capture(),
                storedTags.capture(), eq(0), eq(1), any(Date.class));
        order.verify(auditLogDao).save(audit.capture(), eq("domain-1"));
        return new Inserted(storedId.getValue(), storedTitle.getValue(), storedText.getValue(),
                storedTags.getValue(), 0, 1, audit.getValue());
    }

    private record Inserted(String id, String title, String text, List<String> tags, int creatorType, int status,
            AuditLog audit) {
    }
}
