package com.conflux.identityservice.controller;

import com.conflux.identityservice.dto.LoginRequestDto;
import com.conflux.identityservice.dto.TokenResponseDto;
import com.conflux.identityservice.service.AuthService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final String REFRESH_COOKIE = "conflux_refresh";

    private final AuthService authService;
    private final boolean secureCookies;
    private final String cookieSameSite;

    public AuthController(
            AuthService authService,
            @Value("${app.auth.secure-cookies}") boolean secureCookies,
            @Value("${app.auth.cookie-same-site}") String cookieSameSite) {
        this.authService = authService;
        this.secureCookies = secureCookies;
        this.cookieSameSite = normalizeSameSite(cookieSameSite);
        if ("None".equals(this.cookieSameSite) && !secureCookies) {
            throw new IllegalArgumentException("SameSite=None requires secure cookies");
        }
    }

    @PostMapping(path = "/login", version = "1.0")
    public ResponseEntity<TokenResponseDto> login(
            @Valid @RequestBody LoginRequestDto request,
            HttpServletRequest servletRequest) {
        AuthService.Tokens tokens = authService.login(
                request.usernameOrEmail(), request.password(), servletRequest.getRemoteAddr());
        return tokenResponse(tokens);
    }

    @PostMapping(path = "/refresh", version = "1.0")
    public ResponseEntity<TokenResponseDto> refresh(HttpServletRequest request) {
        return tokenResponse(authService.refresh(refreshCookie(request), request.getRemoteAddr()));
    }

    @PostMapping(path = "/logout", version = "1.0")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        authService.logout(refreshCookie(request));
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie("", Duration.ZERO).toString())
                .build();
    }

    private String refreshCookie(HttpServletRequest request) {
        return request.getCookies() == null ? null
                : Arrays.stream(request.getCookies())
                        .filter(cookie -> REFRESH_COOKIE.equals(cookie.getName()))
                        .map(Cookie::getValue)
                        .findFirst().orElse(null);
    }

    private ResponseEntity<TokenResponseDto> tokenResponse(AuthService.Tokens tokens) {
        Duration refreshLifetime = Duration.between(Instant.now(), tokens.refreshExpiresAt());
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        refreshCookie(tokens.refreshToken(), refreshLifetime).toString())
                .body(new TokenResponseDto(
                        tokens.access().value(), "Bearer", tokens.access().expiresIn()));
    }

    private ResponseCookie refreshCookie(String value, Duration maxAge) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true)
                .secure(secureCookies)
                .sameSite(cookieSameSite)
                .path("/api/auth")
                .maxAge(maxAge.isNegative() ? Duration.ZERO : maxAge)
                .build();
    }

    private String normalizeSameSite(String value) {
        String candidate = value == null ? "" : value.trim();
        if (candidate.isEmpty()) {
            throw new IllegalArgumentException("Cookie SameSite must be Strict, Lax, or None");
        }
        String normalized = candidate.substring(0, 1).toUpperCase(Locale.ROOT)
                + candidate.substring(1).toLowerCase(Locale.ROOT);
        if (!Set.of("Strict", "Lax", "None").contains(normalized)) {
            throw new IllegalArgumentException("Cookie SameSite must be Strict, Lax, or None");
        }
        return normalized;
    }
}
