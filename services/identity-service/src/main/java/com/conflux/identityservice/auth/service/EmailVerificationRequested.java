package com.conflux.identityservice.auth.service;

public record EmailVerificationRequested(String email, String rawToken) {
}
