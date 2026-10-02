package com.conflux.identity_service.service;

public record EmailVerificationRequested(String email, String rawToken) {
}
