package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.InvitationStatus;
import com.conflux.identityservice.team.entity.UserRole;
import java.time.Instant;
import java.util.UUID;

public record TeamInvitationDto(
        UUID invitationId, UUID teamId, String teamName,
        UUID inviterId, String inviterUsername, UUID inviteeId, String inviteeUsername,
        UserRole proposedRole, InvitationStatus status,
        Instant createdAt, Instant expiresAt, Instant respondedAt) {
}
