package io.ontomato.dataengine.config;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.openai.OpenAiChatModelName;
import dev.langchain4j.model.openai.OpenAiTokenCountEstimator;

public final class ToolCallTokenCountEstimator extends OpenAiTokenCountEstimator {

	public ToolCallTokenCountEstimator(OpenAiChatModelName modelName) {
		super(modelName);
	}

	@Override
	public int estimateTokenCountInMessage(ChatMessage message) {
		try {
			return super.estimateTokenCountInMessage(message);
		} catch (RuntimeException error) {
			if (message instanceof AiMessage aiMessage && aiMessage.hasToolExecutionRequests()) {
				return estimateTokenCountInText(aiMessage.toString());
			}
			throw error;
		}
	}
}
