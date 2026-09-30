package io.ontomato.dataengine.service.ai;

import dev.langchain4j.service.Result;

public interface ChatBaseAgent {
	Result<String> chat(String memoryId, String userMessage);
}
