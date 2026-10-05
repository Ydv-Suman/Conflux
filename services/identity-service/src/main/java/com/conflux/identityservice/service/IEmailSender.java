package com.conflux.identityservice.service;

public interface IEmailSender {

    void sendVerificationEmail(String recipient, String verificationUrl);
}
