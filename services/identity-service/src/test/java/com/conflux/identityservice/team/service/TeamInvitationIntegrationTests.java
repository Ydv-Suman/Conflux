package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.dto.CreateTeamRequestDto;
import com.conflux.identityservice.team.entity.InvitationStatus;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@Transactional
class TeamInvitationIntegrationTests {
    @Autowired TeamInvitationService invitations;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate jdbc;
    UUID adminId;
    UUID targetId;
    UUID teamId;
    String targetEmail;

    @BeforeEach
    void setup() {
        adminId = createUser();
        targetId = createUser();
        targetEmail = targetId + "@example.com";
        teamId = teams.create(adminId, new CreateTeamRequestDto("Invitation test", null)).teamId();
    }

    @Test
    void persistedNotificationBecomesMembershipOnlyOnAcceptance() {
        var invitation = invitations.invite(adminId, teamId, request());
        assertEquals(0, membershipCount());
        assertTrue(teams.list(targetId).isEmpty());
        assertEquals(invitation.invitationId(), invitations.inbox(targetId).getFirst().invitationId());
        assertTrue(invitations.inbox(UUID.randomUUID()).isEmpty());
        invitations.respond(targetId, invitation.invitationId(), true);
        invitations.respond(targetId, invitation.invitationId(), true);
        assertEquals(1, membershipCount());
        assertEquals(UserRole.DEVELOPER, teams.get(targetId, teamId).role());
        assertTrue(invitations.inbox(targetId).isEmpty());
        assertEquals("ACCEPTED", jdbc.queryForObject(
                "SELECT status FROM team_invitations WHERE invitation_id = ?", String.class, invitation.invitationId()));
    }

    @Test
    void declineAndCancelNeverGrantMembership() {
        var first = invitations.invite(adminId, teamId, request());
        invitations.respond(targetId, first.invitationId(), false);
        var second = invitations.invite(adminId, teamId, request());
        invitations.cancel(adminId, teamId, second.invitationId());
        assertEquals(0, membershipCount());
        assertTrue(invitations.inbox(targetId).isEmpty());
    }

    @Test
    void expiredInvitationCanBeReplacedWithoutUniqueConstraintFailure() {
        var first = invitations.invite(adminId, teamId, request());
        jdbc.update("UPDATE team_invitations SET created_at = CURRENT_TIMESTAMP - INTERVAL '8 days', "
                + "expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE invitation_id = ?", first.invitationId());
        var second = invitations.invite(adminId, teamId, request());
        assertNotEquals(first.invitationId(), second.invitationId());
        assertEquals(1, invitations.inbox(targetId).size());
        assertEquals(0, membershipCount());
        assertEquals("EXPIRED", jdbc.queryForObject(
                "SELECT status FROM team_invitations WHERE invitation_id = ?", String.class, first.invitationId()));
    }

    @Test
    void duplicateInviteIsRejectedWithoutCreatingMembership() {
        invitations.invite(adminId, teamId, request());
        assertThrows(TeamMembershipConflictException.class, () -> invitations.invite(adminId, teamId, request()));
        assertEquals(0, membershipCount());
    }

    private AddTeamMemberRequestDto request() { return new AddTeamMemberRequestDto(targetEmail, UserRole.DEVELOPER); }
    private int membershipCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM team_members WHERE team_id = ? AND user_id = ?",
                Integer.class, teamId, targetId);
    }
    private UUID createUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (user_id, first_name, last_name, username, created_at, updated_at) "
                + "VALUES (?, 'Test', 'User', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", id, "invite-" + id);
        jdbc.update("INSERT INTO user_emails (user_email_id, user_id, email, verified_at, created_at) "
                + "VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", UUID.randomUUID(), id, id + "@example.com");
        jdbc.update("INSERT INTO local_credentials (user_id, password_hash) VALUES (?, 'not-a-login-hash')", id);
        return id;
    }
}
