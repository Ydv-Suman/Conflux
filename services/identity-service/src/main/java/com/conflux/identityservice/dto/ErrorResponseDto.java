package com.conflux.identityservice.dto;

public record ErrorResponseDto(
        int httpCode,
        String message,
        String url) {
}
