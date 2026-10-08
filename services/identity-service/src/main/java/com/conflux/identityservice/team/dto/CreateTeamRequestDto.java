package com.conflux.identityservice.team.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTeamRequestDto(
        @NotBlank @Size(max = 100) String name) {

    public CreateTeamRequestDto {
        name = name == null ? null : name.trim();
    }
}
