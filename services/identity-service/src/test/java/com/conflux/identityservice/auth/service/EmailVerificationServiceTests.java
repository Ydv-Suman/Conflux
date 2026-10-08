package com.conflux.identityservice.auth.service;

import com.conflux.identityservice.auth.entity.EmailVerificationToken;
import com.conflux.identityservice.user.entity.UserEmail;
import com.conflux.identityservice.auth.exception.InvalidVerificationTokenException;
import com.conflux.identityservice.auth.repository.EmailVerificationTokenRepository;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmailVerificationServiceTests {

    private EmailVerificationToken storedToken;
    private EmailVerificationRequested event;
    private int eventCount;
    private UserEmail resendEmail;
    private final EmailVerificationTokenRepository tokenRepository =
            (EmailVerificationTokenRepository) Proxy.newProxyInstance(
                    EmailVerificationTokenRepository.class.getClassLoader(),
                    new Class<?>[]{EmailVerificationTokenRepository.class},
                    (proxy, method, arguments) -> switch (method.getName()) {
                        case "deleteByUserEmailId" -> { storedToken = null; yield null; }
                        case "save" -> {
                            storedToken = (EmailVerificationToken) arguments[0];
                            storedToken.setCreatedAt(Instant.now());
                            yield storedToken;
                        }
                        case "findLatestByUserEmailId" -> Optional.ofNullable(storedToken);
                        case "findByTokenHashAndConsumedAtIsNull" -> Optional.ofNullable(storedToken)
                                .filter(token -> token.getConsumedAt() == null)
                                .filter(token -> token.getTokenHash().equals(arguments[0]));
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
    private final UserEmailRepository emailRepository =
            (UserEmailRepository) Proxy.newProxyInstance(
                    UserEmailRepository.class.getClassLoader(),
                    new Class<?>[]{UserEmailRepository.class},
                    (proxy, method, arguments) -> Optional.ofNullable(resendEmail));
    private final ApplicationEventPublisher events = published -> {
        event = (EmailVerificationRequested) published;
        eventCount++;
    };
    private final EmailVerificationService service = new EmailVerificationService(
            tokenRepository, emailRepository, events, Duration.ofHours(24));

    @Test
    void tokenIsHashedSingleUseAndVerifiesEmail() {
        UserEmail email = new UserEmail();
        email.setEmail("user@example.com");

        service.issue(email);

        assertNotNull(event);
        assertNotEquals(event.rawToken(), storedToken.getTokenHash());
        service.verify(event.rawToken());
        assertNotNull(email.getVerifiedAt());
        assertNotNull(storedToken.getConsumedAt());
        assertThrows(InvalidVerificationTokenException.class,
                () -> service.verify(event.rawToken()));
    }

    @Test
    void resendHasOneMinuteCooldown() {
        resendEmail = new UserEmail();
        resendEmail.setEmail("user@example.com");

        service.resend(resendEmail.getEmail());
        service.resend(resendEmail.getEmail());

        org.junit.jupiter.api.Assertions.assertEquals(1, eventCount);
    }

    @Test
    void expiredTokenCannotVerifyEmail() {
        UserEmail email = new UserEmail();
        email.setEmail("user@example.com");
        service.issue(email);
        storedToken.setExpiresAt(Instant.now().minusSeconds(1));

        assertThrows(InvalidVerificationTokenException.class,
                () -> service.verify(event.rawToken()));
    }
}
