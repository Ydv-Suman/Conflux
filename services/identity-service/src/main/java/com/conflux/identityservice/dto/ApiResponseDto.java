package com.conflux.identityservice.dto;

public record ApiResponseDto<T>(
        String statusCode,
        String statusMessage,
        T data) {
}
