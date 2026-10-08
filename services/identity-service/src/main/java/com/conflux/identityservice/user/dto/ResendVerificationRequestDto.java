package com.conflux.identityservice.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.text.Normalizer;
import java.util.Locale;

public record ResendVerificationRequestDto(
        @Email(message = "Email must be a valid email address")
        @NotBlank(message = "Email is required")
        String email) {

    public ResendVerificationRequestDto {
        if (email != null) {
            email = Normalizer.normalize(email.trim(), Normalizer.Form.NFKC)
                    .toLowerCase(Locale.ROOT);
        }
    }
}
