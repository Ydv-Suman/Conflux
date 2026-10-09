package com.conflux.workspaceservice.workstream.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateWorkstreamRequestDto(
        @NotBlank @Size(max = 100) String name) {

    public UpdateWorkstreamRequestDto {
        name = name == null ? null : name.trim();
    }
}
