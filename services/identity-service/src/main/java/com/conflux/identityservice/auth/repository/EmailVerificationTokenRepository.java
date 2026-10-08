package com.conflux.identityservice.auth.repository;

import com.conflux.identityservice.auth.entity.EmailVerificationToken;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface EmailVerificationTokenRepository
        extends JpaRepository<EmailVerificationToken, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EmailVerificationToken> findByTokenHashAndConsumedAtIsNull(String tokenHash);

    @Modifying
    @Query(value = "DELETE FROM email_verification_tokens WHERE user_email_id = :userEmailId", nativeQuery = true)
    void deleteByUserEmailId(@Param("userEmailId") UUID userEmailId);

    @Query(value = """
            SELECT * FROM email_verification_tokens
            WHERE user_email_id = :userEmailId
            ORDER BY created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<EmailVerificationToken> findLatestByUserEmailId(@Param("userEmailId") UUID userEmailId);

    @Modifying
    @Query(value = """
            DELETE FROM email_verification_tokens
            WHERE expires_at <= CURRENT_TIMESTAMP OR consumed_at IS NOT NULL
            """, nativeQuery = true)
    int deleteExpiredOrConsumed();
}
