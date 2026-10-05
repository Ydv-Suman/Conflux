package com.conflux.identityservice.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AuthSessionRepository {

    private final JdbcClient jdbc;

    public AuthSessionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void create(UUID sessionId, UUID userId, String tokenHash, Instant expiresAt) {
        jdbc.sql("""
                INSERT INTO auth_sessions(session_id, user_id, refresh_token_hash, expires_at)
                VALUES (:sessionId, :userId, :tokenHash, :expiresAt)
                """)
                .param("sessionId", sessionId)
                .param("userId", userId)
                .param("tokenHash", tokenHash)
                .param("expiresAt", Timestamp.from(expiresAt))
                .update();
    }

    public Optional<Session> rotate(String oldHash, String newHash) {
        return jdbc.sql("""
                UPDATE auth_sessions
                SET refresh_token_hash = :newHash, last_used_at = CURRENT_TIMESTAMP
                WHERE refresh_token_hash = :oldHash
                  AND revoked_at IS NULL
                  AND expires_at > CURRENT_TIMESTAMP
                RETURNING session_id, user_id, expires_at
                """)
                .param("oldHash", oldHash)
                .param("newHash", newHash)
                .query((rs, row) -> new Session(
                        rs.getObject("session_id", UUID.class),
                        rs.getObject("user_id", UUID.class),
                        rs.getTimestamp("expires_at").toInstant()))
                .optional();
    }

    public void revoke(UUID sessionId) {
        jdbc.sql("""
                UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
                WHERE session_id = :sessionId AND revoked_at IS NULL
                """).param("sessionId", sessionId).update();
    }

    public Optional<UUID> revokeByRefreshTokenHash(String tokenHash) {
        return jdbc.sql("""
                UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
                WHERE refresh_token_hash = :tokenHash AND revoked_at IS NULL
                RETURNING user_id
                """)
                .param("tokenHash", tokenHash)
                .query(UUID.class)
                .optional();
    }

    public boolean isActive(UUID sessionId) {
        return jdbc.sql("""
                SELECT EXISTS(
                    SELECT 1 FROM auth_sessions
                    WHERE session_id = :sessionId
                      AND revoked_at IS NULL
                      AND expires_at > CURRENT_TIMESTAMP
                )
                """).param("sessionId", sessionId).query(Boolean.class).single();
    }

    public int deleteExpiredOrRevoked() {
        return jdbc.sql("""
                DELETE FROM auth_sessions
                WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL
                """).update();
    }

    public record Session(UUID sessionId, UUID userId, Instant expiresAt) {
    }
}
