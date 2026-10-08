package com.conflux.identityservice.auth.controller;

import com.conflux.identityservice.auth.service.AuthService;
import com.conflux.identityservice.auth.service.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import jakarta.servlet.http.Cookie;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthControllerTests {

    @Test
    void refreshCookieUsesSecureBrowserAttributesInProduction() {
        AuthService auth = mock(AuthService.class);
        Instant expiresAt = Instant.now().plusSeconds(3600);
        when(auth.login("user", "password", "127.0.0.1")).thenReturn(new AuthService.Tokens(
                new JwtService.AccessToken("access-token", 900, Instant.now().plusSeconds(900)),
                "refresh-token", expiresAt));
        AuthController controller = new AuthController(auth, true, "Strict");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");

        String cookie = controller.login(
                        new com.conflux.identityservice.auth.dto.LoginRequestDto("user", "password"), request)
                .getHeaders().getFirst("Set-Cookie");

        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("Secure"));
        assertTrue(cookie.contains("SameSite=Strict"));
        assertTrue(cookie.contains("Path=/api/auth"));
    }

    @Test
    void logoutRevokesByRefreshCookieAndClearsIt() {
        AuthService auth = mock(AuthService.class);
        AuthController controller = new AuthController(auth, true, "Strict");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("conflux_refresh", "refresh-token"));

        String cookie = controller.logout(request).getHeaders().getFirst("Set-Cookie");

        verify(auth).logout("refresh-token");
        assertTrue(cookie.contains("Max-Age=0"));
        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("Secure"));
    }

    @Test
    void crossSiteCookieRequiresSecureTransport() {
        assertThrows(IllegalArgumentException.class,
                () -> new AuthController(mock(AuthService.class), false, "None"));
    }
}
