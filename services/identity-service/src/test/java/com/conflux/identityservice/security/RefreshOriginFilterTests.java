package com.conflux.identityservice.security;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RefreshOriginFilterTests {

    private final RefreshOriginFilter filter =
            new RefreshOriginFilter(List.of("https://app.conflux.example"));

    @Test
    void acceptsRefreshCookieFromAllowedOrigin() throws Exception {
        MockHttpServletRequest request = refreshRequest();
        request.addHeader("Origin", "https://app.conflux.example");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertEquals(200, response.getStatus());
        assertEquals(request, chain.getRequest());
    }

    @Test
    void rejectsRefreshCookieFromMissingOrUntrustedOrigin() throws Exception {
        for (String origin : new String[]{null, "https://evil.example"}) {
            MockHttpServletRequest request = refreshRequest();
            if (origin != null) {
                request.addHeader("Origin", origin);
            }
            MockHttpServletResponse response = new MockHttpServletResponse();

            filter.doFilter(request, response, new MockFilterChain());

            assertEquals(403, response.getStatus());
        }
    }

    private MockHttpServletRequest refreshRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", PathConfig.REFRESH_API);
        request.setCookies(new Cookie("conflux_refresh", "opaque-refresh-token"));
        return request;
    }
}
