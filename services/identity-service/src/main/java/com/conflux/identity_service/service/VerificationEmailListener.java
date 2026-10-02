package com.conflux.identity_service.service;

import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.MailException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class VerificationEmailListener {

    private static final Logger LOGGER = LoggerFactory.getLogger(VerificationEmailListener.class);

    private final EmailSender emailSender;
    private final String appBaseUrl;

    public VerificationEmailListener(
            EmailSender emailSender,
            @Value("${app.base-url}") String appBaseUrl) {
        this.emailSender = emailSender;
        this.appBaseUrl = appBaseUrl.replaceAll("/+$", "");
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void send(EmailVerificationRequested event) {
        try {
            emailSender.sendVerificationEmail(
                    event.email(), appBaseUrl + "/verify-email?token=" + event.rawToken());
        } catch (MailException failure) {
            LOGGER.error("Verification email delivery failed", failure);
        }
    }
}
