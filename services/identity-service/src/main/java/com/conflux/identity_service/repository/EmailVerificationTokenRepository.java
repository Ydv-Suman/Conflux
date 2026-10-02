package com.conflux.identity_service.repository;

import com.conflux.identity_service.entity.EmailVerificationToken;
import com.conflux.identity_service.entity.UserEmail;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.Optional;
import java.util.UUID;

public interface EmailVerificationTokenRepository
        extends JpaRepository<EmailVerificationToken, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EmailVerificationToken> findByTokenHashAndConsumedAtIsNull(String tokenHash);

    void deleteByUserEmail(UserEmail userEmail);
}
