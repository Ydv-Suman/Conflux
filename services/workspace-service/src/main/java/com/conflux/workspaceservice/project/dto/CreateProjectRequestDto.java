package com.conflux.workspaceservice.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateProjectRequestDto(
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description,
        @NotNull UUID teamId) {

    public CreateProjectRequestDto {
        name = name == null ? null : name.trim();
        description = normalize(description);
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
