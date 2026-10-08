package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.UserRole;

import java.time.Instant;
import java.util.UUID;

public record TeamMemberDto(
        UUID userId,
        String username,
        UserRole role,
        Instant joinedAt) {
}
