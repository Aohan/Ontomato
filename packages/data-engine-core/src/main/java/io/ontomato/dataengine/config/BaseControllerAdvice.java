package io.ontomato.dataengine.config;

import java.io.InputStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.lang.NonNull;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.core.exception.CoreException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
@ControllerAdvice(basePackages = { "io.ontomato.dataengine" })
public class BaseControllerAdvice implements ResponseBodyAdvice<Object> {

    /**
     * Exceptions from the framework itself are assumed to be safe to show to the user directly
     * 
     * @param request
     * @param response
     * @param exception
     */
    @ExceptionHandler({ CoreException.class })
    public void frameworkExceptionHandler(HttpServletRequest request, HttpServletResponse response, Exception exception,
            InputStream is) {
        log.error(exception.getMessage(), exception);
//        int stateCode = HttpStatus.INTERNAL_SERVER_ERROR.value();
        int stateCode = HttpStatus.OK.value();
        response.setCharacterEncoding(StandardCharsets.UTF_8.toString());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setStatus(stateCode);
        // Unified handling method for AJAX requests
        R<?> r = new R<>(exception);
        try (PrintWriter pw = response.getWriter();) {
            pw.write(JSON.toJSONString(r));
            pw.flush();
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
    }

    // /** Unified exception wrapping **/
    @ExceptionHandler({})
    public void exceptionHandler(HttpServletRequest request, HttpServletResponse response, Exception exception) {
        // Unified logging
        log.error(exception.getMessage(), exception);
//        int stateCode = HttpStatus.INTERNAL_SERVER_ERROR.value();
        int stateCode = HttpStatus.OK.value();
        int realCode = stateCode;
        String message = exception.getMessage();
        if (exception instanceof HttpMessageNotReadableException) {
            message = "Invalid parameters!";
        }

        // Exception handling
        response.setCharacterEncoding(StandardCharsets.UTF_8.toString());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setStatus(stateCode);
        // Unified handling method for AJAX requests
        R<String> r = new R<>(false, realCode, message);
        try (PrintWriter pw = response.getWriter();) {
            pw.write(JSON.toJSONString(r));
            pw.flush();
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
    }

    @Override
    public boolean supports(@NonNull MethodParameter returnType,
            @NonNull Class<? extends HttpMessageConverter<?>> converterType) {
        // Need to test whether file types go through this method; if they do, it should return false
        return true;
    }

    @Override
    public Object beforeBodyWrite(@Nullable Object body, @NonNull MethodParameter returnType,
            @NonNull MediaType selectedContentType,
            @NonNull Class<? extends HttpMessageConverter<?>> selectedConverterType, @NonNull ServerHttpRequest request,
            @NonNull ServerHttpResponse response) {
        if (body == null) {
            return body;
        }
        if (body instanceof R) {
            R<?> t = (R<?>) body;
            if (t.getCode() != 200) {
                HttpStatus resolve = HttpStatus.resolve(t.getCode());
                if (resolve != null) {
                    response.setStatusCode(resolve);
                }
            }
            return body;
        }
//        else if (body instanceof String) {
//            return JSON.toJSONString(new R<>(body));
//        }
//        if (body instanceof JSONObject) {
//        return body;
//        }
//        return new R<>(body);
        return body;
    }

}
