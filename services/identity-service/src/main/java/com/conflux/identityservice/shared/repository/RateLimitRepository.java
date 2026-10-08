package com.conflux.identityservice.shared.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@Repository
public class RateLimitRepository {

    private final JdbcClient jdbc;

    public RateLimitRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean consume(String bucketKey, int maximum, long windowSeconds) {
        lock(bucketKey);
        long count = count(bucketKey, windowSeconds);
        if (count >= maximum) {
            return false;
        }
        jdbc.sql("INSERT INTO rate_limit_events(bucket_key) VALUES (:bucketKey)")
                .param("bucketKey", bucketKey).update();
        return true;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public long loginCooldownRemaining(
            String bucketKey, int maximum, long windowSeconds, long cooldownSeconds) {
        lock(bucketKey);
        LoginWindow window = jdbc.sql("""
                SELECT COUNT(*) AS failures,
                       CASE WHEN COUNT(*) < :maximum THEN 0
                            ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
                                MAX(occurred_at) + (:cooldown * INTERVAL '1 second')
                                - CURRENT_TIMESTAMP))))::BIGINT
                       END AS retry_after
                FROM rate_limit_events
                WHERE bucket_key = :bucketKey
                  AND occurred_at > CURRENT_TIMESTAMP - (:window * INTERVAL '1 second')
                """)
                .param("bucketKey", bucketKey)
                .param("maximum", maximum)
                .param("window", windowSeconds)
                .param("cooldown", cooldownSeconds)
                .query((rs, row) -> new LoginWindow(
                        rs.getLong("failures"), rs.getLong("retry_after")))
                .single();
        if (window.failures() >= maximum && window.retryAfter() == 0) {
            clearWithinTransaction(bucketKey);
        }
        return window.retryAfter();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String bucketKey) {
        lock(bucketKey);
        jdbc.sql("INSERT INTO rate_limit_events(bucket_key) VALUES (:bucketKey)")
                .param("bucketKey", bucketKey).update();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void clear(String bucketKey) {
        lock(bucketKey);
        clearWithinTransaction(bucketKey);
    }

    public long retryAfter(String bucketKey, long windowSeconds) {
        return jdbc.sql("""
                SELECT COALESCE(GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                    MIN(occurred_at) + (:window * INTERVAL '1 second')
                    - CURRENT_TIMESTAMP))))::BIGINT, 1)
                FROM rate_limit_events
                WHERE bucket_key = :bucketKey
                  AND occurred_at > CURRENT_TIMESTAMP - (:window * INTERVAL '1 second')
                """)
                .param("bucketKey", bucketKey)
                .param("window", windowSeconds)
                .query(Long.class).single();
    }

    public int deleteOlderThan(long seconds) {
        return jdbc.sql("""
                DELETE FROM rate_limit_events
                WHERE occurred_at <= CURRENT_TIMESTAMP - (:seconds * INTERVAL '1 second')
                """).param("seconds", seconds).update();
    }

    private long count(String bucketKey, long windowSeconds) {
        return jdbc.sql("""
                SELECT COUNT(*) FROM rate_limit_events
                WHERE bucket_key = :bucketKey
                  AND occurred_at > CURRENT_TIMESTAMP - (:seconds * INTERVAL '1 second')
                """)
                .param("bucketKey", bucketKey)
                .param("seconds", windowSeconds)
                .query(Long.class).single();
    }

    private void lock(String bucketKey) {
        jdbc.sql("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(:bucketKey, 0))")
                .param("bucketKey", bucketKey).query(Long.class).single();
    }

    private void clearWithinTransaction(String bucketKey) {
        jdbc.sql("DELETE FROM rate_limit_events WHERE bucket_key = :bucketKey")
                .param("bucketKey", bucketKey).update();
    }

    private record LoginWindow(long failures, long retryAfter) {
    }
}
