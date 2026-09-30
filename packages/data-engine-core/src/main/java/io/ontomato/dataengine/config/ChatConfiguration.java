package io.ontomato.dataengine.config;


import static dev.langchain4j.model.openai.OpenAiChatModelName.GPT_4_O_MINI;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.ontomato.dataengine.filter.CorsFilter;

import dev.langchain4j.memory.ChatMemory;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.memory.chat.TokenWindowChatMemory;
import dev.langchain4j.model.TokenCountEstimator;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Configuration
public class ChatConfiguration {

    @Bean
    public FilterRegistrationBean<CorsFilter> corsFilter() {
        FilterRegistrationBean<CorsFilter> registrationBean = new FilterRegistrationBean<>();
        registrationBean.setFilter(new CorsFilter());
        registrationBean.addUrlPatterns("/*"); // Set the filter URL pattern; * means this filter applies to all paths
        registrationBean.setOrder(-1001);
        return registrationBean;
    }

//    @Bean
//    ChatMemoryProvider chatMemoryProvider(TokenCountEstimator tokenizerEstimator) {
//        return memoryId -> TokenWindowChatMemory.builder()
//                .id(memoryId)
//                .maxTokens(50000, tokenizerEstimator)
//                .build();
//    }
    private final Map<Object, ChatMemory> memories = new ConcurrentHashMap<>();
    @Bean
    ChatMemoryProvider chatMemoryProvider(TokenCountEstimator tokenizerEstimator) {
        return memoryId -> memories.computeIfAbsent(memoryId,
            id -> TokenWindowChatMemory.builder()
                .id(id)
                .maxTokens(500000, tokenizerEstimator)
                .build());
    }

    @Bean
    TokenCountEstimator tokenCountEstimator() {
        return new ToolCallTokenCountEstimator(GPT_4_O_MINI);
    }

}
