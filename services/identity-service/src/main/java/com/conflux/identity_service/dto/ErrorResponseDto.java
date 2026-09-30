package com.conflux.identity_service.dto;

public record ErrorResponseDto(
        int httpCode,
        String message,
        String url) {
}
