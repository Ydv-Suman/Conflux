package com.conflux.identityservice.controller;

import com.conflux.identityservice.service.AuthService;
import com.conflux.identityservice.service.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthControllerTests {

    @Test
    void refreshCookieUsesSecureBrowserAttributesInProduction() {
        AuthService auth = mock(AuthService.class);
        Instant expiresAt = Instant.now().plusSeconds(3600);
        when(auth.login("user", "password", "127.0.0.1")).thenReturn(new AuthService.Tokens(
                new JwtService.AccessToken("access-token", 900, Instant.now().plusSeconds(900)),
                "refresh-token", expiresAt));
        AuthController controller = new AuthController(auth, true);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");

        String cookie = controller.login(
                        new com.conflux.identityservice.dto.LoginRequestDto("user", "password"), request)
                .getHeaders().getFirst("Set-Cookie");

        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("Secure"));
        assertTrue(cookie.contains("SameSite=Strict"));
        assertTrue(cookie.contains("Path=/api/auth"));
    }
}
