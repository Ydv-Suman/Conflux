package com.conflux.identityservice.user.service;

import com.conflux.identityservice.user.dto.RegisterUserRequestDto;
import com.conflux.identityservice.user.entity.User;
import com.conflux.identityservice.user.exception.PasswordMismatchException;
import com.conflux.identityservice.user.repository.UserRepository;
import com.conflux.identityservice.user.repository.UserSqlRepository;
import com.conflux.identityservice.auth.service.EmailVerificationService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

import java.lang.reflect.Proxy;
import java.sql.SQLException;
import java.time.Duration;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
class UserServiceImplTests {

    private Consumer<User> saveBehavior = user -> { };
    private User savedUser;
    private final UserRepository repository = (UserRepository) Proxy.newProxyInstance(
            UserRepository.class.getClassLoader(),
            new Class<?>[]{UserRepository.class},
            (proxy, method, arguments) -> {
                if (method.getName().equals("saveAndFlush")) {
                    savedUser = (User) arguments[0];
                    saveBehavior.accept(savedUser);
                    return savedUser;
                }
                throw new UnsupportedOperationException(method.getName());
            });
    private final PasswordEncoder encoder = new PasswordEncoder() {
        @Override
        public String encode(CharSequence rawPassword) {
            return "hash";
        }

        @Override
        public boolean matches(CharSequence rawPassword, String encodedPassword) {
            return false;
        }
    };
    private final EmailVerificationService verificationService =
            new EmailVerificationService(null, null, null, Duration.ofHours(24)) {
                @Override
                public void issue(com.conflux.identityservice.user.entity.UserEmail email) {
                }
            };
    private final TransactionOperations transactions = new TransactionOperations() {
        @Override
        public <T> T execute(TransactionCallback<T> action) {
            return action.doInTransaction(null);
        }
    };
    private final UserSqlRepository userSqlRepository = mock(UserSqlRepository.class);
    private final com.conflux.identityservice.team.repository.TeamMemberRepository teamMembers =
            mock(com.conflux.identityservice.team.repository.TeamMemberRepository.class);
    private final UserServiceImpl service =
            new UserServiceImpl(repository, encoder, verificationService, transactions,
                    userSqlRepository, teamMembers);

    @Test
    void normalizesIdentityAndHidesConcurrentDuplicates() {
        RegisterUserRequestDto request = new RegisterUserRequestDto(
                "  First  ", "   ", "  Last  ", "  Test.User  ", "  USER@Example.COM  ",
                "LongPassword1!", "LongPassword1!");
        assertEquals("First", request.firstName());
        assertNull(request.middleName());
        assertEquals("Last", request.lastName());
        saveBehavior = user -> {
            org.junit.jupiter.api.Assertions.assertEquals("test.user", user.getUsername());
            org.junit.jupiter.api.Assertions.assertEquals(
                    "user@example.com", user.getPrimaryEmail().getEmail());
            throw new DataIntegrityViolationException(
                    "duplicate user_emails_email_lower_uq",
                    new SQLException("duplicate user_emails_email_lower_uq", "23505"));
        };

        assertDoesNotThrow(() -> service.registerUser(request));
        assertEquals("hash", savedUser.getLocalCredential().getPasswordHash());
    }

    @Test
    void rejectsPasswordMismatch() {
        RegisterUserRequestDto request = new RegisterUserRequestDto(
                "First", null, "Last", "test.user", "user@example.com",
                "LongPassword1!", "DifferentPass1!");

        assertThrows(PasswordMismatchException.class, () -> service.registerUser(request));
    }

    @Test
    void doesNotHideUnrelatedUniqueViolations() {
        RegisterUserRequestDto request = new RegisterUserRequestDto(
                "First", null, "Last", "test.user", "user@example.com",
                "LongPassword1!", "LongPassword1!");
        DataIntegrityViolationException failure = new DataIntegrityViolationException(
                "duplicate unrelated_constraint",
                new SQLException("duplicate unrelated_constraint", "23505"));
        saveBehavior = user -> { throw failure; };

        assertEquals(failure, assertThrows(
                DataIntegrityViolationException.class,
                () -> service.registerUser(request)));
    }
}
