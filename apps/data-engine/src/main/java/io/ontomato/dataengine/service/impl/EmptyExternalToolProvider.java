package io.ontomato.dataengine.service.impl;

import java.util.Map;

import org.springframework.stereotype.Component;

import dev.langchain4j.service.tool.ToolProvider;
import dev.langchain4j.service.tool.ToolProviderRequest;
import dev.langchain4j.service.tool.ToolProviderResult;

/** OSS connects to no external MCP endpoint. Built-in tools stay on the chat builder. */
@Component
public class EmptyExternalToolProvider implements ToolProvider {

    @Override
    public ToolProviderResult provideTools(ToolProviderRequest request) {
        return new ToolProviderResult(Map.of());
    }
}
