package com.conflux.workspaceservice.workstream.dto;

import com.conflux.workspaceservice.workstream.entity.WorkstreamStatus;

import java.time.Instant;
import java.util.UUID;

public record WorkstreamDto(
        UUID workstreamId,
        UUID projectId,
        String name,
        String branchName,
        String baseRevision,
        String currentRevision,
        WorkstreamStatus status,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
