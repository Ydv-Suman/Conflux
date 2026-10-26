package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.entity.*;
import com.conflux.identityservice.team.exception.*;
import com.conflux.identityservice.team.repository.*;
import com.conflux.identityservice.user.entity.*;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TeamInvitationServiceTests {
    private final TeamInvitationRepository invitations = mock(TeamInvitationRepository.class);
    private final TeamMemberRepository members = mock(TeamMemberRepository.class);
    private final UserEmailRepository emails = mock(UserEmailRepository.class);
    private final TeamInvitationService service = new TeamInvitationService(
            invitations, members, emails, new TeamAuthorizationService(members));
    private final UUID adminId = UUID.randomUUID();
    private final UUID targetId = UUID.randomUUID();
    private final UUID teamId = UUID.randomUUID();
    private final UUID invitationId = UUID.randomUUID();
    private TeamMember admin;
    private TeamInvitation invitation;
    private UserEmail targetEmail;

    @BeforeEach
    void setup() {
        Team team = new Team();
        team.setTeamId(teamId);
        team.setName("Payments");
        User inviter = user(adminId, "admin");
        User target = user(targetId, "target");
        targetEmail = new UserEmail();
        targetEmail.setEmail("target@example.com");
        targetEmail.setVerifiedAt(Instant.now());
        target.setPrimaryEmail(targetEmail);
        admin = new TeamMember();
        admin.setTeam(team);
        admin.setUser(inviter);
        admin.setRole(UserRole.ADMIN);
        invitation = new TeamInvitation();
        invitation.setInvitationId(invitationId);
        invitation.setTeam(team);
        invitation.setInviter(inviter);
        invitation.setInvitee(target);
        invitation.setProposedRole(UserRole.DEVELOPER);
        invitation.setCreatedAt(Instant.now());
        invitation.setExpiresAt(Instant.now().plusSeconds(3600));
        when(members.findAllForUpdate(teamId)).thenReturn(List.of(admin));
        when(emails.findVerifiedByEmail("target@example.com")).thenReturn(Optional.of(targetEmail));
        when(invitations.findTeamIdForInvitee(invitationId, targetId)).thenReturn(Optional.of(teamId));
        when(invitations.findForUpdate(invitationId)).thenReturn(Optional.of(invitation));
    }

    @Test
    void invitationDoesNotCreateMembership() {
        var result = service.invite(adminId, teamId, request(UserRole.DEVELOPER));
        assertEquals(InvitationStatus.PENDING, result.status());
        assertEquals(targetId, result.inviteeId());
        assertEquals("Payments", result.teamName());
        assertTrue(result.expiresAt().isAfter(result.createdAt()));
        verify(invitations).saveAndFlush(any(TeamInvitation.class));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void onlyAcceptanceCreatesMembershipAndRepeatedAcceptanceDoesNotDuplicate() {
        assertEquals(InvitationStatus.ACCEPTED, service.respond(targetId, invitationId, true).status());
        assertEquals(InvitationStatus.ACCEPTED, service.respond(targetId, invitationId, true).status());
        var captor = org.mockito.ArgumentCaptor.forClass(TeamMember.class);
        verify(members, times(1)).saveAndFlush(captor.capture());
        assertEquals(targetId, captor.getValue().getUser().getUserId());
        assertEquals(UserRole.DEVELOPER, captor.getValue().getRole());
        assertNotNull(invitation.getRespondedAt());
    }

    @Test
    void declineDoesNotCreateMembershipAndIsIdempotent() {
        assertEquals(InvitationStatus.DECLINED, service.respond(targetId, invitationId, false).status());
        assertEquals(InvitationStatus.DECLINED, service.respond(targetId, invitationId, false).status());
        assertThrows(TeamMembershipConflictException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void anotherUserCannotRespondOrDiscoverInvitation() {
        assertThrows(InvitationNotFoundException.class, () -> service.respond(adminId, invitationId, true));
        assertThrows(InvitationNotFoundException.class, () -> service.respond(adminId, invitationId, false));
        verify(invitations, never()).findForUpdate(any());
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void expiredAndCancelledInvitationsCannotBeAccepted() {
        invitation.setExpiresAt(Instant.now().minusSeconds(1));
        assertThrows(TeamMembershipConflictException.class, () -> service.respond(targetId, invitationId, true));
        invitation.setExpiresAt(Instant.now().plusSeconds(3600));
        service.cancel(adminId, teamId, invitationId);
        assertEquals(InvitationStatus.CANCELLED, invitation.getStatus());
        assertThrows(TeamMembershipConflictException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void inviterDemotionPreventsAcceptanceButNotDecline() {
        admin.setRole(UserRole.DEVELOPER);
        assertThrows(TeamAccessDeniedException.class, () -> service.respond(targetId, invitationId, true));
        assertEquals(InvitationStatus.DECLINED, service.respond(targetId, invitationId, false).status());
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void removedInviterCannotGrantAccess() {
        when(members.findAllForUpdate(teamId)).thenReturn(List.of());
        assertThrows(TeamNotFoundException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void roleEscalationIsRejectedAtCreationAndAcceptance() {
        admin.setRole(UserRole.TEAM_LEAD);
        assertThrows(TeamAccessDeniedException.class, () -> service.invite(adminId, teamId, request(UserRole.ADMIN)));
        invitation.setProposedRole(UserRole.TEAM_LEAD);
        assertThrows(TeamAccessDeniedException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void duplicatePendingInvitationIsRejected() {
        when(invitations.existsByTeamTeamIdAndInviteeUserIdAndStatus(teamId, targetId, InvitationStatus.PENDING))
                .thenReturn(true);
        assertThrows(TeamMembershipConflictException.class, () -> service.invite(adminId, teamId, request(UserRole.DEVELOPER)));
        verify(invitations, never()).saveAndFlush(any());
    }

    @Test
    void existingMemberCannotBeInvitedOrAddedAgain() {
        TeamMember target = new TeamMember();
        target.setUser(invitation.getInvitee());
        when(members.findAllForUpdate(teamId)).thenReturn(List.of(admin, target));
        assertThrows(TeamMembershipConflictException.class, () -> service.invite(adminId, teamId, request(UserRole.DEVELOPER)));
        assertThrows(TeamMembershipConflictException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void nonManagerCannotInviteOrCancel() {
        admin.setRole(UserRole.DEVELOPER);
        assertThrows(TeamAccessDeniedException.class, () -> service.invite(adminId, teamId, request(UserRole.DEVELOPER)));
        assertThrows(TeamAccessDeniedException.class, () -> service.cancel(adminId, teamId, invitationId));
    }

    @Test
    void cancellationCannotCrossTeamBoundary() {
        Team other = new Team();
        other.setTeamId(UUID.randomUUID());
        invitation.setTeam(other);
        assertThrows(InvitationNotFoundException.class, () -> service.cancel(adminId, teamId, invitationId));
        assertEquals(InvitationStatus.PENDING, invitation.getStatus());
    }

    @Test
    void inboxIsScopedToRecipientAndIncludesNotificationContext() {
        when(invitations.findTop100ByInviteeUserIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                eq(targetId), eq(InvitationStatus.PENDING), any())).thenReturn(List.of(invitation));
        var inbox = service.inbox(targetId);
        assertEquals(1, inbox.size());
        assertEquals("admin", inbox.getFirst().inviterUsername());
        assertEquals("Payments", inbox.getFirst().teamName());
    }

    @Test
    void unverifiedRecipientCannotAccept() {
        targetEmail.setVerifiedAt(null);
        assertThrows(TeamMembershipConflictException.class, () -> service.respond(targetId, invitationId, true));
        verify(members, never()).saveAndFlush(any());
    }

    private AddTeamMemberRequestDto request(UserRole role) {
        return new AddTeamMemberRequestDto("target@example.com", role);
    }
    private User user(UUID id, String username) {
        User user = new User();
        user.setUserId(id);
        user.setUsername(username);
        return user;
    }
}
