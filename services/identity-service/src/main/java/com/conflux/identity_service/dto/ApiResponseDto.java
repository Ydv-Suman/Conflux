package com.conflux.identity_service.dto;

public record ApiResponseDto<T>(
        String statusCode,
        String statusMessage,
        T data) {
}
