package com.conflux.identityservice.shared.dto;

public record ErrorResponseDto(
        int httpCode,
        String message,
        String url) {
}
