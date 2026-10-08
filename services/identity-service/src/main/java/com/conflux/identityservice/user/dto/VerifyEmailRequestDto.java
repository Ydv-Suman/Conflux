package com.conflux.identityservice.user.dto;

import jakarta.validation.constraints.NotBlank;

public record VerifyEmailRequestDto(
        @NotBlank(message = "Verification token is required")
        String token) {
}
