package com.conflux.workspaceservice.project.dto;

import com.conflux.workspaceservice.project.entity.RepositoryAccessMode;
import java.util.UUID;

public record ProjectRepositoryDto(
        UUID projectId,
        String repositoryUrl,
        RepositoryAccessMode accessMode,
        String canonicalBranch,
        String canonicalRevision,
        long version) {
}
