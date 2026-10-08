package com.conflux.identityservice.auth.service;

public interface IEmailSender {

    void sendVerificationEmail(String recipient, String verificationUrl);
}
