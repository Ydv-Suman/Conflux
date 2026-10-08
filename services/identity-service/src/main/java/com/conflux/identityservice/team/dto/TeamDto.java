package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.UserRole;

import java.time.Instant;
import java.util.UUID;

public record TeamDto(UUID teamId, String name, UserRole role, Instant createdAt) {
}
