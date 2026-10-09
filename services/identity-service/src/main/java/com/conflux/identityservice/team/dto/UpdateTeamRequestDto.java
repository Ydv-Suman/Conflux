package com.conflux.identityservice.team.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateTeamRequestDto(
        @NotBlank @Size(max = 100) String name) {

    public UpdateTeamRequestDto {
        name = name == null ? null : name.trim();
    }
}
