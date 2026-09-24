package io.ontomato.dataengine.filter;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

public class CorsFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletResponse response = (HttpServletResponse) res;
        HttpServletRequest request = (HttpServletRequest) req;

        // Set the allowed origins; here * allows all domains, or a concrete domain may be specified
        response.setHeader("Access-Control-Allow-Origin", "*");
        // Set the allowed request methods, such as POST, GET, etc.
        response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
        // Set the allowed headers, such as Content-Type, Authorization, etc.
        response.setHeader("Access-Control-Allow-Headers", "*");
        // Cache time for preflight requests, in seconds
        response.setHeader("Access-Control-Max-Age", "3600");
        // Allow sending cookies
        response.setHeader("Access-Control-Allow-Credentials", "true");

        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            response.setStatus(HttpServletResponse.SC_OK);
        } else {
            chain.doFilter(req, res);
        }
    }
}