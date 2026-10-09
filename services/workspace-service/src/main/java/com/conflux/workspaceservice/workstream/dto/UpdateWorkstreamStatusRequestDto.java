package com.conflux.workspaceservice.workstream.dto;

import com.conflux.workspaceservice.workstream.entity.WorkstreamStatus;
import jakarta.validation.constraints.NotNull;

public record UpdateWorkstreamStatusRequestDto(
        @NotNull WorkstreamStatus status) {
}
