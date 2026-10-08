package com.conflux.identityservice.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.text.Normalizer;
import java.util.Locale;

public record UpdateUserRequestDto(
        @NotBlank(message = "First name is required")
        @Size(max = 50, message = "First name must be less than 50 characters")
        String firstName,

        @Size(max = 50, message = "Middle name must be less than 50 characters")
        String middleName,

        @NotBlank(message = "Last name is required")
        @Size(max = 50, message = "Last name must be less than 50 characters")
        String lastName,

        @NotBlank(message = "Username is required")
        @Size(min = 5, max = 50, message = "Username must be between 5 and 50 characters")
        @Pattern(
                regexp = "^[a-zA-Z0-9._-]+$",
                message = "Username may only contain letters, digits, dots, hyphens, and underscores")
        String username) {

    public UpdateUserRequestDto {
        firstName = trim(firstName);
        middleName = blankToNull(middleName);
        lastName = trim(lastName);
        username = username == null ? null
                : Normalizer.normalize(username.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String blankToNull(String value) {
        String trimmed = trim(value);
        return trimmed == null || trimmed.isEmpty() ? null : trimmed;
    }
}
