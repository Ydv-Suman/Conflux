package com.conflux.identityservice.auth.service;

import com.conflux.identityservice.auth.entity.EmailVerificationToken;
import com.conflux.identityservice.user.entity.UserEmail;
import com.conflux.identityservice.auth.exception.InvalidVerificationTokenException;
import com.conflux.identityservice.auth.repository.EmailVerificationTokenRepository;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger LOGGER = LoggerFactory.getLogger(EmailVerificationService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration RESEND_COOLDOWN = Duration.ofMinutes(1);

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
        tokenRepository.deleteByUserEmailId(email.getUserEmailId());

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
        LOGGER.info("event=EMAIL_VERIFIED user_email_id={}", token.getUserEmail().getUserEmailId());
    }

    @Transactional
    public void resend(String email) {
        emailRepository.findUnverifiedByEmailForUpdate(email).ifPresent(userEmail -> {
            boolean coolingDown = tokenRepository.findLatestByUserEmailId(userEmail.getUserEmailId())
                    .map(token -> token.getCreatedAt().isAfter(Instant.now().minus(RESEND_COOLDOWN)))
                    .orElse(false);
            if (!coolingDown) {
                issue(userEmail);
            }
        });
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
