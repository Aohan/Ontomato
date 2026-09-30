package io.ontomato.dataengine.service.ai;

import dev.langchain4j.service.*;

public interface ChatAgent {
    @SystemMessage(fromResource = "prompt.md")
    Result<String> chat(@MemoryId String memoryId,@UserMessage String userMessage);
}
