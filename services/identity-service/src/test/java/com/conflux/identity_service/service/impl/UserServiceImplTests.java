package com.conflux.identity_service.service.impl;

import com.conflux.identity_service.dto.RegisterUserRequestDto;
import com.conflux.identity_service.entity.User;
import com.conflux.identity_service.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceImplTests {

    private final UserRepository repository = mock(UserRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final UserServiceImpl service = new UserServiceImpl(repository, encoder);

    @Test
    void normalizesIdentityAndHidesConcurrentDuplicates() {
        RegisterUserRequestDto request = new RegisterUserRequestDto(
                "First", null, "Last", "  Test.User  ", "  USER@Example.COM  ",
                "Password1!", "Password1!");
        when(encoder.encode(request.password())).thenReturn("hash");
        when(repository.saveAndFlush(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            org.junit.jupiter.api.Assertions.assertEquals("test.user", user.getUsername());
            org.junit.jupiter.api.Assertions.assertEquals("user@example.com", user.getEmail());
            throw new DataIntegrityViolationException(
                    "duplicate", new SQLException("duplicate", "23505"));
        });

        assertDoesNotThrow(() -> service.registerUser(request));
        verify(repository).saveAndFlush(any(User.class));
    }
}
