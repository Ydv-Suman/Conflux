package com.conflux.identity_service.service;

import com.conflux.identity_service.entity.EmailVerificationToken;
import com.conflux.identity_service.entity.UserEmail;
import com.conflux.identity_service.exception.InvalidVerificationTokenException;
import com.conflux.identity_service.repository.EmailVerificationTokenRepository;
import com.conflux.identity_service.repository.UserEmailRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
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

@Service
public class EmailVerificationService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final EmailVerificationTokenRepository tokenRepository;
    private final UserEmailRepository emailRepository;
    private final ApplicationEventPublisher events;
    private final Duration tokenTtl;

    public EmailVerificationService(
            EmailVerificationTokenRepository tokenRepository,
            UserEmailRepository emailRepository,
            ApplicationEventPublisher events,
            @Value("${app.email-verification-ttl}") Duration tokenTtl) {
        this.tokenRepository = tokenRepository;
        this.emailRepository = emailRepository;
        this.events = events;
        this.tokenTtl = tokenTtl;
    }

    public void issue(UserEmail email) {
        tokenRepository.deleteByUserEmail(email);

        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        EmailVerificationToken token = new EmailVerificationToken();
        token.setUserEmail(email);
        token.setTokenHash(hash(rawToken));
        token.setExpiresAt(Instant.now().plus(tokenTtl));
        tokenRepository.save(token);
        events.publishEvent(new EmailVerificationRequested(email.getEmail(), rawToken));
    }

    @Transactional
    public void verify(String rawToken) {
        EmailVerificationToken token = tokenRepository
                .findByTokenHashAndConsumedAtIsNull(hash(rawToken))
                .orElseThrow(() -> invalidToken());
        Instant now = Instant.now();
        if (!token.getExpiresAt().isAfter(now)) {
            throw invalidToken();
        }
        token.setConsumedAt(now);
        token.getUserEmail().setVerifiedAt(now);
        token.getUserEmail().setVerificationSource("LOCAL");
    }

    @Transactional
    public void resend(String email) {
        emailRepository.findByEmail(email)
                .filter(userEmail -> userEmail.getVerifiedAt() == null)
                .ifPresent(this::issue);
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private InvalidVerificationTokenException invalidToken() {
        return new InvalidVerificationTokenException("Verification token is invalid or expired");
    }
}
