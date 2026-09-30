package com.conflux.identity_service.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

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

    @Size(min = 8, max = 20, message = "Password must be between 8 and 20 characters")
    @NotBlank(message = "Password is required")
    @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>/?]).+$",
            message = "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
    )
    String password,

    @NotBlank(message = "Confirm password is required")
    String confirmPassword

) {

}
