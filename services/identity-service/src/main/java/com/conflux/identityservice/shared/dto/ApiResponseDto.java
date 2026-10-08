package com.conflux.identityservice.shared.dto;

public record ApiResponseDto<T>(
        String statusCode,
        String statusMessage,
        T data) {
}
