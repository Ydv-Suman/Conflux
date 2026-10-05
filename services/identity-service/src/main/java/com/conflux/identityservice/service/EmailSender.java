package com.conflux.identityservice.service;

public interface EmailSender {

    void sendVerificationEmail(String recipient, String verificationUrl);
}
