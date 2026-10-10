package com.conflux.identityservice.team.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTeamRequestDto(
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description) {

    public CreateTeamRequestDto {
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
