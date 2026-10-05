package com.conflux.identityservice.service;

import com.conflux.identityservice.exception.InvalidCredentialsException;
import com.conflux.identityservice.exception.RateLimitExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest
class AuthServiceIntegrationTests {

    @Autowired
    private AuthService authService;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcTemplate jdbc;

    private UUID userId;

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM rate_limit_events");
        if (userId != null) {
            jdbc.update("DELETE FROM users WHERE user_id = ?", userId);
        }
    }

    @Test
    void loginRefreshAndLogoutRevokesTheWholeSession() {
        createVerifiedUser();

        AuthService.Tokens login = authService.login("login.user", "LongPassword1!", "127.0.0.1");
        Jwt firstAccess = jwtDecoder.decode(login.access().value());
        assertEquals(userId.toString(), firstAccess.getSubject());

        AuthService.Tokens refreshed = authService.refresh(login.refreshToken(), "127.0.0.1");
        assertNotEquals(login.refreshToken(), refreshed.refreshToken());
        assertThrows(InvalidCredentialsException.class,
                () -> authService.refresh(login.refreshToken(), "127.0.0.1"));

        Jwt refreshedAccess = jwtDecoder.decode(refreshed.access().value());
        authService.logout(refreshedAccess);

        assertThrows(JwtValidationException.class,
                () -> jwtDecoder.decode(login.access().value()));
        assertThrows(JwtValidationException.class,
                () -> jwtDecoder.decode(refreshed.access().value()));
    }

    @Test
    void failedLoginsAreRateLimitedAcrossRolledBackAuthenticationTransactions() {
        createVerifiedUser();

        for (int attempt = 0; attempt < 5; attempt++) {
            assertThrows(InvalidCredentialsException.class,
                    () -> authService.login("login.user", "WrongPassword1!", "127.0.0.2"));
        }

        assertThrows(RateLimitExceededException.class,
                () -> authService.login("login.user", "LongPassword1!", "127.0.0.2"));

        jdbc.update("""
                UPDATE rate_limit_events
                SET occurred_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds'
                WHERE bucket_key LIKE 'login-account:%'
                """);

        authService.login("login.user", "LongPassword1!", "127.0.0.2");
        assertEquals(0, jdbc.queryForObject("""
                SELECT COUNT(*) FROM rate_limit_events
                WHERE bucket_key LIKE 'login-account:%'
                """, Integer.class));
    }

    @Test
    void unverifiedUserCannotLogin() {
        createUser(false);

        assertThrows(InvalidCredentialsException.class,
                () -> authService.login("login.user", "LongPassword1!", "127.0.0.3"));
    }

    private void createVerifiedUser() {
        createUser(true);
    }

    private void createUser(boolean verified) {
        userId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO users(user_id, first_name, last_name, username, created_at, updated_at)
                VALUES (?, 'Login', 'User', 'login.user', ?, ?)
                """, userId, Timestamp.from(now), Timestamp.from(now));
        jdbc.update("""
                INSERT INTO user_emails(user_email_id, user_id, email, verified_at, created_at)
                VALUES (?, ?, 'login.user@example.com', ?, ?)
                """, UUID.randomUUID(), userId, verified ? Timestamp.from(now) : null, Timestamp.from(now));
        jdbc.update("""
                INSERT INTO local_credentials(user_id, password_hash) VALUES (?, ?)
                """, userId, passwordEncoder.encode("LongPassword1!"));
    }
}
