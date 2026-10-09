package com.conflux.workspaceservice.shared.dto;

public record ErrorResponseDto(
        int httpCode,
        String message,
        String url) {
}
