package com.conflux.identityservice.user.service;

import com.conflux.identityservice.user.dto.UpdateUserRequestDto;
import com.conflux.identityservice.user.dto.UserDto;
import com.conflux.identityservice.user.exception.UserNotFoundException;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.user.repository.UserRepository;
import com.conflux.identityservice.user.repository.UserSqlRepository;
import com.conflux.identityservice.auth.service.EmailVerificationService;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

class UserCrudServiceTests {

    private final UserSqlRepository sql = mock(UserSqlRepository.class);
    private final TeamMemberRepository teamMembers = mock(TeamMemberRepository.class);
    private final UserServiceImpl service = new UserServiceImpl(
            mock(UserRepository.class), mock(PasswordEncoder.class),
            mock(EmailVerificationService.class), mock(TransactionOperations.class), sql,
            teamMembers);

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

    @Test
    void soleTeamAdminCannotDeleteAccount() {
        UUID userId = UUID.randomUUID();
        when(teamMembers.isSoleAdminOfAnyTeam(userId)).thenReturn(true);

        assertThrows(TeamMembershipConflictException.class, () -> service.deleteUser(userId));

        verify(sql, never()).delete(userId);
    }
}
