package io.ontomato.dataengine.service.ai;

import dev.langchain4j.service.*;

public interface ToolAgent extends ChatBaseAgent {
    Result<String> chat(@MemoryId String memoryId,@UserMessage String userMessage);
}
