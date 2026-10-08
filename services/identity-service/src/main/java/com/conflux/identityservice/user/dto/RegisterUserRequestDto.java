package com.conflux.identityservice.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.text.Normalizer;
import java.util.Locale;

public record RegisterUserRequestDto (

    @Size(max=50, message = "First name must be less than 50 characters")
    @NotBlank( message = "First name is required")
    String firstName,

    @Size(max=50, message = "Middle name must be less than 50 characters")
    String middleName,

    @Size(max=50, message = "Last name must be less than 50 characters")
    @NotBlank( message = "Last name is required")
    String lastName,

    @Size(min = 5, max = 50, message = "Username must be between 5 and 50 characters")
    @NotBlank(message = "Username is required")
    @Pattern(
            regexp = "^[a-zA-Z0-9._-]+$",
            message = "Username may only contain letters, digits, dots, hyphens, and underscores"
    )
    String username,

    @Size(max = 100, message = "Email must not exceed 100 characters")
    @Email(message = "Email must be a valid email address")
    @NotBlank(message = "Email is required")
    String email,

    @Size(min = 12, max = 128, message = "Password must be between 12 and 128 characters")
    @NotBlank(message = "Password is required")
    String password,

    @Size(min = 12, max = 128, message = "Confirm password must be between 12 and 128 characters")
    @NotBlank(message = "Confirm password is required")
    String confirmPassword

) {

    public RegisterUserRequestDto {
        firstName = trim(firstName);
        middleName = blankToNull(middleName);
        lastName = trim(lastName);
        username = normalizeIdentity(username);
        email = normalizeIdentity(email);
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String blankToNull(String value) {
        String trimmed = trim(value);
        return trimmed == null || trimmed.isEmpty() ? null : trimmed;
    }

    private static String normalizeIdentity(String value) {
        return value == null ? null
                : Normalizer.normalize(value.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

}
