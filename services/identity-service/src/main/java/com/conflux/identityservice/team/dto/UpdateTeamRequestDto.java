package com.conflux.identityservice.team.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateTeamRequestDto(
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description) {

    public UpdateTeamRequestDto {
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
