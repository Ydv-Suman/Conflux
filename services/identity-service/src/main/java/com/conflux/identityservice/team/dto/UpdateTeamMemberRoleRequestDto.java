package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.UserRole;
import jakarta.validation.constraints.NotNull;

public record UpdateTeamMemberRoleRequestDto(@NotNull UserRole role) {
}
