package com.conflux.identity_service.dto;

import jakarta.validation.constraints.NotBlank;

public record VerifyEmailRequestDto(
        @NotBlank(message = "Verification token is required")
        String token) {
}
