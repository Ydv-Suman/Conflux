package com.conflux.identityservice.auth.dto;

public record TokenResponseDto(String accessToken, String tokenType, long expiresIn) {
}
