package com.conflux.identityservice.service;

public record EmailVerificationRequested(String email, String rawToken) {
}
