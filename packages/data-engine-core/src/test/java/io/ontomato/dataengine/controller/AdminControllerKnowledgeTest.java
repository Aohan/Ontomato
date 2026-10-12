package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * Knowledge without content, and edits or deletes without an ID, used to be skipped while the endpoints still answered
 * success, so the caller reported a save or delete that never happened.
 */
class AdminControllerKnowledgeTest {

	private final AdminController controller = new AdminController();
	private final KnowledgeService knowledgeService = mock(KnowledgeService.class);
	private final User user = mock(User.class);

	@BeforeEach
	void wire() {
		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		LangService langService = mock(LangService.class);
		when(langService.get(any(), anyString())).thenAnswer(call -> call.getArgument(0) + ":" + call.getArgument(1));
		ReflectionTestUtils.setField(controller, "knowledgeService", knowledgeService);
		ReflectionTestUtils.setField(controller, "langService", langService);
	}

	private static JSONObject payload(String id, String text) {
		return new JSONObject()
				.fluentPut("knowledgeID", id)
				.fluentPut("knowledgeTitle", "Refund rule")
				.fluentPut("knowledgeText", text)
				.fluentPut("knowledgeTags", List.of("Business"))
				.fluentPut("status", 1);
	}

	private static void assertRefused(JSONObject ret) {
		assertRefused("Admin.knowledge.textRequired", ret);
	}

	private static void assertRefused(String key, JSONObject ret) {
		assertFalse(ret.getBooleanValue("success"), ret.toString());
		assertEquals("zh-CN:" + key, ret.getString("message"));
	}

	@Test
	void addAndEditRefuseEmptyOrBlankContentInTheRequestLanguageWithoutSaving() {
		assertRefused(controller.addBussinessKnowledge("zh-CN", payload("", "")));
		assertRefused(controller.addBussinessKnowledge("zh-CN", payload("", "  \n ")));
		assertRefused(controller.editBussinessKnowledge("zh-CN", payload("k1", "")));
		assertRefused(controller.editBussinessKnowledge("zh-CN", payload("k1", "   ")));
		verifyNoInteractions(knowledgeService);
	}

	@Test
	void editAndDeleteRefuseAMissingOrBlankIdInTheRequestLanguageWithoutTouchingTheStore() {
		assertRefused("Admin.knowledge.idRequired", controller.editBussinessKnowledge("zh-CN", payload(null, "Within 7 days")));
		assertRefused("Admin.knowledge.idRequired", controller.editBussinessKnowledge("zh-CN", payload(" ", "Within 7 days")));
		assertRefused("Admin.knowledge.idRequired", controller.delBussinessKnowledge("zh-CN", new JSONObject()));
		assertRefused("Admin.knowledge.idRequired",
				controller.delBussinessKnowledge("zh-CN", new JSONObject().fluentPut("knowledgeID", "")));
		verifyNoInteractions(knowledgeService);
	}

	@Test
	void deleteWithAnIdDeletesIt() {
		assertTrue(controller.delBussinessKnowledge("en", new JSONObject().fluentPut("knowledgeID", "k1")).getBooleanValue("success"));
		verify(knowledgeService).delBussinessKnowledge("k1", user);
	}

	@Test
	void contentIsTrimmedAndSaved() {
		assertTrue(controller.addBussinessKnowledge("en", payload("", "  Within 7 days ")).getBooleanValue("success"));
		verify(knowledgeService).addBussinessKnowledge("", "Refund rule", "Within 7 days", 1, List.of("Business"), user);

		assertTrue(controller.editBussinessKnowledge("en", payload("k1", "Within 14 days")).getBooleanValue("success"));
		verify(knowledgeService).editBussinessKnowledge("k1", "Refund rule", "Within 14 days", 1, List.of("Business"), user);
	}
}
