package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.dto.TeamInvitationDto;
import com.conflux.identityservice.team.entity.*;
import com.conflux.identityservice.team.exception.*;
import com.conflux.identityservice.team.repository.TeamInvitationRepository;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.user.exception.UserNotFoundException;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class TeamInvitationService {
    private static final Logger LOGGER = LoggerFactory.getLogger(TeamInvitationService.class);
    private static final Duration TTL = Duration.ofDays(7);
    private final TeamInvitationRepository invitations;
    private final TeamMemberRepository members;
    private final UserEmailRepository emails;
    private final TeamAuthorizationService authorization;

    public TeamInvitationService(TeamInvitationRepository invitations, TeamMemberRepository members,
            UserEmailRepository emails, TeamAuthorizationService authorization) {
        this.invitations = invitations;
        this.members = members;
        this.emails = emails;
        this.authorization = authorization;
    }

    @Transactional
    public TeamInvitationDto invite(UUID actorId, UUID teamId, AddTeamMemberRequestDto request) {
        List<TeamMember> locked = members.findAllForUpdate(teamId);
        TeamMember actor = manager(locked, actorId);
        authorization.requireCanManageRole(actor.getRole(), UserRole.VIEWER, request.role());
        var email = emails.findVerifiedByEmail(request.email()).orElseThrow(UserNotFoundException::new);
        UUID targetId = email.getUser().getUserId();
        if (locked.stream().anyMatch(m -> m.getUser().getUserId().equals(targetId))) {
            throw conflict("User is already a team member");
        }
        Instant now = Instant.now();
        invitations.expirePending(teamId, targetId, now);
        if (invitations.existsByTeamTeamIdAndInviteeUserIdAndStatus(teamId, targetId, InvitationStatus.PENDING)) {
            throw conflict("A pending invitation already exists for this user");
        }
        TeamInvitation invitation = new TeamInvitation();
        invitation.setTeam(actor.getTeam());
        invitation.setInviter(actor.getUser());
        invitation.setInvitee(email.getUser());
        invitation.setProposedRole(request.role());
        invitation.setCreatedAt(now);
        invitation.setExpiresAt(now.plus(TTL));
        invitations.saveAndFlush(invitation);
        audit(invitation, actorId);
        return dto(invitation);
    }

    @Transactional(readOnly = true)
    public List<TeamInvitationDto> inbox(UUID actorId) {
        return invitations.findTop100ByInviteeUserIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                actorId, InvitationStatus.PENDING, Instant.now()).stream().map(this::dto).toList();
    }

    @Transactional(readOnly = true)
    public List<TeamInvitationDto> list(UUID actorId, UUID teamId) {
        authorization.requireCapability(authorization.requireMember(teamId, actorId), Capability.MANAGE_MEMBERS);
        return invitations.findTop100ByTeamTeamIdOrderByCreatedAtDesc(teamId).stream().map(this::dto).toList();
    }

    @Transactional
    public TeamInvitationDto respond(UUID actorId, UUID invitationId, boolean accept) {
        // All mutations lock team memberships before the invitation, matching role/removal operations.
        UUID teamId = invitations.findTeamIdForInvitee(invitationId, actorId)
                .orElseThrow(InvitationNotFoundException::new);
        List<TeamMember> locked = members.findAllForUpdate(teamId);
        TeamInvitation invitation = invitations.findForUpdate(invitationId).orElseThrow(InvitationNotFoundException::new);
        InvitationStatus desired = accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED;
        if (invitation.getStatus() == desired) return dto(invitation);
        requirePending(invitation);
        if (accept) {
            TeamMember inviter = manager(locked, invitation.getInviter().getUserId());
            authorization.requireCanManageRole(inviter.getRole(), UserRole.VIEWER, invitation.getProposedRole());
            if (invitation.getInvitee().getPrimaryEmail() == null
                    || invitation.getInvitee().getPrimaryEmail().getVerifiedAt() == null) {
                throw conflict("Verified email is required");
            }
            if (locked.stream().anyMatch(m -> m.getUser().getUserId().equals(actorId))) {
                throw conflict("User is already a team member");
            }
            TeamMember membership = new TeamMember();
            membership.setTeam(invitation.getTeam());
            membership.setUser(invitation.getInvitee());
            membership.setRole(invitation.getProposedRole());
            members.saveAndFlush(membership);
        }
        invitation.setStatus(desired);
        invitation.setRespondedAt(Instant.now());
        audit(invitation, actorId);
        return dto(invitation);
    }

    @Transactional
    public void cancel(UUID actorId, UUID teamId, UUID invitationId) {
        manager(members.findAllForUpdate(teamId), actorId);
        TeamInvitation invitation = invitations.findForUpdate(invitationId).orElseThrow(InvitationNotFoundException::new);
        if (!invitation.getTeam().getTeamId().equals(teamId)) throw new InvitationNotFoundException();
        if (invitation.getStatus() == InvitationStatus.CANCELLED) return;
        requirePending(invitation);
        invitation.setStatus(InvitationStatus.CANCELLED);
        invitation.setRespondedAt(Instant.now());
        audit(invitation, actorId);
    }

    private TeamMember manager(List<TeamMember> locked, UUID actorId) {
        TeamMember actor = locked.stream().filter(m -> m.getUser().getUserId().equals(actorId))
                .findFirst().orElseThrow(TeamNotFoundException::new);
        authorization.requireCapability(actor, Capability.MANAGE_MEMBERS);
        return actor;
    }

    private void requirePending(TeamInvitation invitation) {
        if (invitation.getStatus() != InvitationStatus.PENDING) throw conflict("Invitation is no longer pending");
        if (!invitation.getExpiresAt().isAfter(Instant.now())) throw conflict("Invitation has expired");
    }

    private TeamInvitationDto dto(TeamInvitation i) {
        InvitationStatus status = i.getStatus() == InvitationStatus.PENDING && !i.getExpiresAt().isAfter(Instant.now())
                ? InvitationStatus.EXPIRED : i.getStatus();
        return new TeamInvitationDto(i.getInvitationId(), i.getTeam().getTeamId(), i.getTeam().getName(),
                i.getInviter().getUserId(), i.getInviter().getUsername(), i.getInvitee().getUserId(),
                i.getInvitee().getUsername(), i.getProposedRole(), status,
                i.getCreatedAt(), i.getExpiresAt(), i.getRespondedAt());
    }

    private TeamMembershipConflictException conflict(String message) { return new TeamMembershipConflictException(message); }
    private void audit(TeamInvitation i, UUID actorId) {
        LOGGER.info("event=TEAM_INVITATION_CHANGED invitation_id={} team_id={} actor_id={} invitee_id={} status={}",
                i.getInvitationId(), i.getTeam().getTeamId(), actorId, i.getInvitee().getUserId(), i.getStatus());
    }
}
