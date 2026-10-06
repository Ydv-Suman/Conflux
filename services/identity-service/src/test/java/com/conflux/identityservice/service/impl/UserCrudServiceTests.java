package com.conflux.identityservice.service.impl;

import com.conflux.identityservice.dto.UpdateUserRequestDto;
import com.conflux.identityservice.dto.UserDto;
import com.conflux.identityservice.exception.UserNotFoundException;
import com.conflux.identityservice.repository.UserRepository;
import com.conflux.identityservice.repository.UserSqlRepository;
import com.conflux.identityservice.service.EmailVerificationService;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserCrudServiceTests {

    private final UserSqlRepository sql = mock(UserSqlRepository.class);
    private final UserServiceImpl service = new UserServiceImpl(
            mock(UserRepository.class), mock(PasswordEncoder.class),
            mock(EmailVerificationService.class), mock(TransactionOperations.class), sql);

    @Test
    void readsOnlyTheRequestedAuthenticatedUserProfile() {
        UUID userId = UUID.randomUUID();
        when(sql.findProfile(userId)).thenReturn(Optional.of(new UserSqlRepository.UserProfile(
                "Ada", null, "Lovelace", "ada@example.com", "ada.user", true, Instant.EPOCH)));

        UserDto result = service.getUser(userId);

        assertEquals("ada.user", result.getUsername());
        assertEquals("ada@example.com", result.getEmail());
    }

    @Test
    void updateFailsWhenSqlUpdatesNoUser() {
        UUID userId = UUID.randomUUID();
        UpdateUserRequestDto request = new UpdateUserRequestDto("Ada", null, "Lovelace", "ada.user");
        when(sql.update(userId, request)).thenReturn(0);

        assertThrows(UserNotFoundException.class, () -> service.updateUser(userId, request));
    }

    @Test
    void deleteUsesAuthenticatedUserId() {
        UUID userId = UUID.randomUUID();
        when(sql.delete(userId)).thenReturn(1);

        service.deleteUser(userId);

        verify(sql).delete(userId);
    }
}
