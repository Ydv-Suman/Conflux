package com.conflux.identityservice.team.dto;

import com.conflux.identityservice.team.entity.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Locale;

public record AddTeamMemberRequestDto(
        @NotBlank @Email @Size(max = 100) String email,
        @NotNull UserRole role) {

    public AddTeamMemberRequestDto {
        email = email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }
}
