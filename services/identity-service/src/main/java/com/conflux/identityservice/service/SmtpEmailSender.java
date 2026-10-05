package com.conflux.identityservice.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class SmtpEmailSender implements EmailSender {

    private final JavaMailSender mailSender;
    private final String from;

    public SmtpEmailSender(JavaMailSender mailSender, @Value("${app.mail-from}") String from) {
        this.mailSender = mailSender;
        this.from = from;
    }

    @Override
    public void sendVerificationEmail(String recipient, String verificationUrl) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(recipient);
        message.setSubject("Verify your Conflux account");
        message.setText("""
                Hello,

                Thank you for creating a Conflux account. Please verify your email address by visiting the link below:

                %s

                If you did not create a Conflux account, you can safely ignore this email.

                Best regards,
                The Conflux Team
                """.formatted(verificationUrl));
        mailSender.send(message);
    }
}
