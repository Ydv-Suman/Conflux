package com.conflux.identityservice.auth.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AuthSqlRepository {

    private static final String SELECT_USER = """
            SELECT u.user_id, u.username, lc.password_hash, ue.verified_at
            FROM users u
            JOIN local_credentials lc ON lc.user_id = u.user_id
            JOIN user_emails ue ON ue.user_id = u.user_id
            """;

    private final JdbcClient jdbc;

    public AuthSqlRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<AuthUser> findByUsernameOrEmail(String usernameOrEmail) {
        return jdbc.sql(SELECT_USER + " WHERE u.username = :usernameOrEmail OR ue.email = :usernameOrEmail")
                .param("usernameOrEmail", usernameOrEmail)
                .query((rs, row) -> new AuthUser(
                        rs.getObject("user_id", UUID.class),
                        rs.getString("username"),
                        rs.getString("password_hash"),
                        rs.getTimestamp("verified_at") == null
                                ? null : rs.getTimestamp("verified_at").toInstant()))
                .optional();
    }

    public Optional<AuthUser> findByUserId(UUID userId) {
        return jdbc.sql(SELECT_USER + " WHERE u.user_id = :userId")
                .param("userId", userId)
                .query((rs, row) -> new AuthUser(
                        rs.getObject("user_id", UUID.class),
                        rs.getString("username"),
                        rs.getString("password_hash"),
                        rs.getTimestamp("verified_at") == null
                                ? null : rs.getTimestamp("verified_at").toInstant()))
                .optional();
    }

    public record AuthUser(UUID userId, String username, String passwordHash, Instant verifiedAt) {
    }
}
