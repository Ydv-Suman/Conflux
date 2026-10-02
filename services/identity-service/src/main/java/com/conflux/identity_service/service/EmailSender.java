package com.conflux.identity_service.service;

public interface EmailSender {

    void sendVerificationEmail(String recipient, String verificationUrl);
}
