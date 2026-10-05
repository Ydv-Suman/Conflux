package com.conflux.identityservice.dto;

import jakarta.validation.constraints.NotBlank;

public record VerifyEmailRequestDto(
        @NotBlank(message = "Verification token is required")
        String token) {
}
