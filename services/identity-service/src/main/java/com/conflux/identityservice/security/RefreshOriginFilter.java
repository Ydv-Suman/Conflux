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
        if (isCookieRefresh(request) && (origin == null || !allowedOrigins.contains(origin))) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Refresh request origin is not allowed");
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean isCookieRefresh(HttpServletRequest request) {
        return HttpMethod.POST.matches(request.getMethod())
                && REFRESH_API.equals(request.getRequestURI())
                && request.getCookies() != null
                && Arrays.stream(request.getCookies()).anyMatch(cookie ->
                        REFRESH_COOKIE.equals(cookie.getName()) && !cookie.getValue().isBlank());
    }
}
