package com.conflux.identityservice.service.impl;

import com.conflux.identityservice.constants.ApplicationConstants;
import com.conflux.identityservice.dto.RegisterUserRequestDto;
import com.conflux.identityservice.entity.LocalCredential;
import com.conflux.identityservice.entity.User;
import com.conflux.identityservice.entity.UserEmail;
import com.conflux.identityservice.exception.PasswordMismatchException;
import com.conflux.identityservice.repository.UserRepository;
import com.conflux.identityservice.service.IUserService;
import com.conflux.identityservice.service.EmailVerificationService;
import org.springframework.dao.DataIntegrityViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.sql.SQLException;

@Service
public class UserServiceImpl implements IUserService {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserServiceImpl.class);
    private static final String USERNAME_UNIQUE_INDEX = "users_username_lower_uq";
    private static final String EMAIL_UNIQUE_INDEX = "user_emails_email_lower_uq";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailVerificationService emailVerificationService;
    private final TransactionOperations transactions;


    public UserServiceImpl(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            EmailVerificationService emailVerificationService,
            TransactionOperations transactions) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailVerificationService = emailVerificationService;
        this.transactions = transactions;
    }


    @Override
    public void registerUser(RegisterUserRequestDto registerRequestDto) {
        validatePasswordConfirmation(registerRequestDto.password(), registerRequestDto.confirmPassword());

        User user = new User();
        user.setFirstName(registerRequestDto.firstName());
        user.setMiddleName(registerRequestDto.middleName());
        user.setLastName(registerRequestDto.lastName());
        user.setUsername(registerRequestDto.username());
        UserEmail email = new UserEmail();
        email.setEmail(registerRequestDto.email());
        user.setPrimaryEmail(email);

        LocalCredential credential = new LocalCredential();
        credential.setPasswordHash(passwordEncoder.encode(registerRequestDto.password()));
        user.setLocalCredential(credential);

        try {
            transactions.executeWithoutResult(ignored -> {
                userRepository.saveAndFlush(user);
                emailVerificationService.issue(email);
            });
            LOGGER.info("event=ACCOUNT_CREATED user_id={}", user.getUserId());
        } catch (DataIntegrityViolationException failure) {
            if (!isIdentityUniqueViolation(failure)) {
                throw failure;
            }
            // The response intentionally does not reveal whether the account exists.
            return;
        }
    }

    @Override
    public void verifyEmail(String token) {
        emailVerificationService.verify(token);
    }

    @Override
    public void resendVerification(String email) {
        emailVerificationService.resend(email);
    }

    private void validatePasswordConfirmation(String password, String confirmPassword) {
        if (!password.equals(confirmPassword)) {
            throw new PasswordMismatchException(ApplicationConstants.PASSWORD_MISMATCH);
        }
    }

    private boolean isIdentityUniqueViolation(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sqlException
                    && "23505".equals(sqlException.getSQLState())) {
                for (Throwable detail = failure; detail != null; detail = detail.getCause()) {
                    String message = detail.getMessage();
                    if (message != null && (message.contains(USERNAME_UNIQUE_INDEX)
                            || message.contains(EMAIL_UNIQUE_INDEX))) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
