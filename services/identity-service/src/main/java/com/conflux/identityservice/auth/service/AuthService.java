package com.conflux.identityservice.auth.service;

import com.conflux.identityservice.shared.service.RateLimitService;
import com.conflux.identityservice.auth.exception.InvalidCredentialsException;
import com.conflux.identityservice.auth.repository.AuthSessionRepository;
import com.conflux.identityservice.auth.repository.AuthSqlRepository;
import com.conflux.identityservice.auth.repository.RevokedJwtRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AuthService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final AuthSqlRepository users;
    private final AuthSessionRepository sessions;
    private final RevokedJwtRepository revokedJwts;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RateLimitService rateLimits;
    private final Duration refreshTtl;
    private final String dummyPasswordHash;

    public AuthService(
            AuthSqlRepository users,
            AuthSessionRepository sessions,
            RevokedJwtRepository revokedJwts,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            RateLimitService rateLimits,
            @Value("${app.jwt.refresh-ttl}") Duration refreshTtl) {
        this.users = users;
        this.sessions = sessions;
        this.revokedJwts = revokedJwts;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.rateLimits = rateLimits;
        this.refreshTtl = refreshTtl;
        this.dummyPasswordHash = passwordEncoder.encode(randomToken());
    }

    @Transactional
    public Tokens login(String usernameOrEmail, String password, String clientIp) {
        rateLimits.checkLogin(usernameOrEmail, clientIp);
        AuthSqlRepository.AuthUser user = users.findByUsernameOrEmail(usernameOrEmail).orElse(null);
        boolean passwordMatches = passwordEncoder.matches(
                password, user == null ? dummyPasswordHash : user.passwordHash());
        if (!passwordMatches || user == null || user.verifiedAt() == null) {
            rateLimits.recordLoginFailure(usernameOrEmail);
            LOGGER.warn("event=AUTH_LOGIN_FAILED");
            throw new InvalidCredentialsException();
        }
        rateLimits.clearLoginFailures(usernameOrEmail);

        UUID sessionId = UUID.randomUUID();
        String refreshToken = randomToken();
        Instant refreshExpiresAt = Instant.now().plus(refreshTtl);
        sessions.create(sessionId, user.userId(), hash(refreshToken), refreshExpiresAt);
        JwtService.AccessToken access = jwtService.issue(user.userId(), user.username(), sessionId);
        LOGGER.info("event=AUTH_LOGIN_SUCCESS user_id={}", user.userId());
        return new Tokens(access, refreshToken, refreshExpiresAt);
    }

    @Transactional
    public Tokens refresh(String oldRefreshToken, String clientIp) {
        if (oldRefreshToken == null || oldRefreshToken.isBlank()) {
            throw invalidRefresh(clientIp);
        }
        rateLimits.checkRefresh(oldRefreshToken, clientIp);
        String newRefreshToken = randomToken();
        AuthSessionRepository.Session session = sessions
                .rotate(hash(oldRefreshToken), hash(newRefreshToken))
                .orElseThrow(() -> invalidRefresh(clientIp));
        AuthSqlRepository.AuthUser user = users.findByUserId(session.userId())
                .filter(candidate -> candidate.verifiedAt() != null)
                .orElseThrow(() -> invalidRefresh(clientIp));
        JwtService.AccessToken access = jwtService.issue(user.userId(), user.username(), session.sessionId());
        LOGGER.info("event=AUTH_TOKEN_REFRESHED user_id={}", user.userId());
        return new Tokens(access, newRefreshToken, session.expiresAt());
    }

    @Transactional
    public void logout(Jwt jwt) {
        revokedJwts.revoke(UUID.fromString(jwt.getId()), jwt.getExpiresAt());
        sessions.revoke(UUID.fromString(jwt.getClaimAsString("sid")));
        LOGGER.info("event=AUTH_LOGOUT_SUCCESS user_id={}", jwt.getSubject());
    }

    @Transactional
    public void logout(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return;
        }
        sessions.revokeByRefreshTokenHash(hash(refreshToken)).ifPresent(userId ->
                LOGGER.info("event=AUTH_LOGOUT_SUCCESS user_id={}", userId));
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private InvalidCredentialsException invalidRefresh(String clientIp) {
        LOGGER.warn("event=AUTH_TOKEN_REFRESH_FAILED");
        return new InvalidCredentialsException();
    }

    public record Tokens(JwtService.AccessToken access, String refreshToken, Instant refreshExpiresAt) {
    }
}
