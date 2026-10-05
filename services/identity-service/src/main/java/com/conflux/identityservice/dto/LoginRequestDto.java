package com.conflux.identityservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.text.Normalizer;
import java.util.Locale;

public record LoginRequestDto(
        @NotBlank(message = "Username or email is required")
        @Size(max = 100, message = "Username or email is too long")
        String usernameOrEmail,

        @NotBlank(message = "Password is required")
        @Size(max = 128, message = "Password is too long")
        String password) {

    public LoginRequestDto {
        if (usernameOrEmail != null) {
            usernameOrEmail = Normalizer.normalize(usernameOrEmail.trim(), Normalizer.Form.NFKC)
                    .toLowerCase(Locale.ROOT);
        }
    }
}
