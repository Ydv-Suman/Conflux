package com.conflux.identityservice.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import static com.conflux.identityservice.security.PathConfig.LOGOUT_API;
import static com.conflux.identityservice.security.PathConfig.REFRESH_API;

@Component
public class RefreshOriginFilter extends OncePerRequestFilter {

    private static final String REFRESH_COOKIE = "conflux_refresh";
    private final List<String> allowedOrigins;

    public RefreshOriginFilter(@Qualifier("allowedCorsOrigins") List<String> allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        if (isCookieAuthRequest(request) && (origin == null || !allowedOrigins.contains(origin))) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Authentication request origin is not allowed");
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean isCookieAuthRequest(HttpServletRequest request) {
        return HttpMethod.POST.matches(request.getMethod())
                && (REFRESH_API.equals(request.getRequestURI())
                    || LOGOUT_API.equals(request.getRequestURI()))
                && request.getCookies() != null
                && Arrays.stream(request.getCookies()).anyMatch(cookie ->
                        REFRESH_COOKIE.equals(cookie.getName()) && !cookie.getValue().isBlank());
    }
}
