package com.conflux.workspaceservice.project.dto;

import java.time.Instant;
import java.util.UUID;

public record ProjectDto(
        UUID projectId,
        String name,
        String description,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
