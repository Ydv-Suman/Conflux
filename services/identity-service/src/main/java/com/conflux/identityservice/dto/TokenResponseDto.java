package com.conflux.identityservice.dto;

public record TokenResponseDto(String accessToken, String tokenType, long expiresIn) {
}
