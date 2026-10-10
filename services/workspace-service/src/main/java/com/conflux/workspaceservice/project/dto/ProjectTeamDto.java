package com.conflux.workspaceservice.project.dto;

import java.time.Instant;
import java.util.UUID;

public record ProjectTeamDto(UUID teamId, UUID addedBy, Instant addedAt) {
}
