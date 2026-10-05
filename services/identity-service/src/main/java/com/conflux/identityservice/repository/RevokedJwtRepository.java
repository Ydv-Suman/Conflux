package com.conflux.identityservice.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.UUID;

@Repository
public class RevokedJwtRepository {

    private final JdbcClient jdbc;

    public RevokedJwtRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void revoke(UUID jti, Instant expiresAt) {
        jdbc.sql("""
                INSERT INTO revoked_jwts(jti, expires_at)
                VALUES (:jti, :expiresAt)
                ON CONFLICT (jti) DO NOTHING
                """).param("jti", jti).param("expiresAt", Timestamp.from(expiresAt)).update();
    }

    public boolean exists(UUID jti) {
        return jdbc.sql("SELECT EXISTS(SELECT 1 FROM revoked_jwts WHERE jti = :jti)")
                .param("jti", jti).query(Boolean.class).single();
    }

    public int deleteExpired() {
        return jdbc.sql("DELETE FROM revoked_jwts WHERE expires_at <= CURRENT_TIMESTAMP").update();
    }
}
