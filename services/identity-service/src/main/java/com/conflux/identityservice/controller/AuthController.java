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
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;

import static com.conflux.identityservice.security.PathConfig.AUTH;
import static com.conflux.identityservice.security.PathConfig.LOGIN;
import static com.conflux.identityservice.security.PathConfig.LOGOUT;
import static com.conflux.identityservice.security.PathConfig.REFRESH;

@RestController
@RequestMapping(AUTH)
public class AuthController {

    private static final String REFRESH_COOKIE = "conflux_refresh";

    private final AuthService authService;
    private final boolean secureCookies;

    public AuthController(
            AuthService authService,
            @Value("${app.auth.secure-cookies}") boolean secureCookies) {
        this.authService = authService;
        this.secureCookies = secureCookies;
    }

    @PostMapping(path = LOGIN, version = "1.0")
    public ResponseEntity<TokenResponseDto> login(
            @Valid @RequestBody LoginRequestDto request,
            HttpServletRequest servletRequest) {
        AuthService.Tokens tokens = authService.login(
                request.usernameOrEmail(), request.password(), servletRequest.getRemoteAddr());
        return tokenResponse(tokens);
    }

    @PostMapping(path = REFRESH, version = "1.0")
    public ResponseEntity<TokenResponseDto> refresh(HttpServletRequest request) {
        String refreshToken = request.getCookies() == null ? null
                : Arrays.stream(request.getCookies())
                        .filter(cookie -> REFRESH_COOKIE.equals(cookie.getName()))
                        .map(Cookie::getValue)
                        .findFirst().orElse(null);
        return tokenResponse(authService.refresh(refreshToken, request.getRemoteAddr()));
    }

    @PostMapping(path = LOGOUT, version = "1.0")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal Jwt jwt) {
        authService.logout(jwt);
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie("", Duration.ZERO).toString())
                .build();
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
                .sameSite("Strict")
                .path("/api/auth")
                .maxAge(maxAge.isNegative() ? Duration.ZERO : maxAge)
                .build();
    }
}
