package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.UserRole;

import java.util.Set;
import java.util.UUID;

public record TeamCapabilitiesDto(
        UUID teamId,
        UUID userId,
        UserRole role,
        Set<Capability> capabilities) {
}
