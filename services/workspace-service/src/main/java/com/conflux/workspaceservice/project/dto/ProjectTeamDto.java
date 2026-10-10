package com.conflux.workspaceservice.project.dto;

import java.time.Instant;
import java.util.UUID;

public record ProjectTeamDto(
        UUID teamId,
        String name,
        String description,
        UUID addedBy,
        Instant addedAt) {
}
