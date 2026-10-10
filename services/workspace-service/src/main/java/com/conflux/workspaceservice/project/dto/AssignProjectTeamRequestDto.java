package com.conflux.workspaceservice.project.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AssignProjectTeamRequestDto(@NotNull UUID teamId) {
}
