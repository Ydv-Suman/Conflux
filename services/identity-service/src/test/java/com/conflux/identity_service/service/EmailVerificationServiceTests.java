package com.conflux.identity_service.service;

import com.conflux.identity_service.entity.EmailVerificationToken;
import com.conflux.identity_service.entity.UserEmail;
import com.conflux.identity_service.exception.InvalidVerificationTokenException;
import com.conflux.identity_service.repository.EmailVerificationTokenRepository;
import com.conflux.identity_service.repository.UserEmailRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmailVerificationServiceTests {

    private EmailVerificationToken storedToken;
    private EmailVerificationRequested event;
    private final EmailVerificationTokenRepository tokenRepository =
            (EmailVerificationTokenRepository) Proxy.newProxyInstance(
                    EmailVerificationTokenRepository.class.getClassLoader(),
                    new Class<?>[]{EmailVerificationTokenRepository.class},
                    (proxy, method, arguments) -> switch (method.getName()) {
                        case "deleteByUserEmail" -> { storedToken = null; yield null; }
                        case "save" -> storedToken = (EmailVerificationToken) arguments[0];
                        case "findByTokenHashAndConsumedAtIsNull" -> Optional.ofNullable(storedToken)
                                .filter(token -> token.getConsumedAt() == null)
                                .filter(token -> token.getTokenHash().equals(arguments[0]));
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
    private final UserEmailRepository emailRepository =
            (UserEmailRepository) Proxy.newProxyInstance(
                    UserEmailRepository.class.getClassLoader(),
                    new Class<?>[]{UserEmailRepository.class},
                    (proxy, method, arguments) -> Optional.empty());
    private final ApplicationEventPublisher events = published ->
            event = (EmailVerificationRequested) published;
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
}
