package com.conflux.identityservice.user.service;

import com.conflux.identityservice.shared.constants.ApplicationConstants;
import com.conflux.identityservice.user.dto.RegisterUserRequestDto;
import com.conflux.identityservice.user.dto.UpdateUserRequestDto;
import com.conflux.identityservice.user.dto.UserDto;
import com.conflux.identityservice.auth.entity.LocalCredential;
import com.conflux.identityservice.user.entity.User;
import com.conflux.identityservice.user.entity.UserEmail;
import com.conflux.identityservice.user.exception.PasswordMismatchException;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import com.conflux.identityservice.user.exception.UserNotFoundException;
import com.conflux.identityservice.user.exception.UsernameAlreadyExistsException;
import com.conflux.identityservice.user.repository.UserSqlRepository;
import com.conflux.identityservice.user.repository.UserRepository;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.user.service.IUserService;
import com.conflux.identityservice.auth.service.EmailVerificationService;
import org.springframework.dao.DataIntegrityViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionOperations;

import java.sql.SQLException;
import java.util.UUID;

@Service
public class UserServiceImpl implements IUserService {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserServiceImpl.class);
    private static final String USERNAME_UNIQUE_INDEX = "users_username_lower_uq";
    private static final String EMAIL_UNIQUE_INDEX = "user_emails_email_lower_uq";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailVerificationService emailVerificationService;
    private final TransactionOperations transactions;
    private final UserSqlRepository userSqlRepository;
    private final TeamMemberRepository teamMembers;


    public UserServiceImpl(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            EmailVerificationService emailVerificationService,
            TransactionOperations transactions,
            UserSqlRepository userSqlRepository,
            TeamMemberRepository teamMembers) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailVerificationService = emailVerificationService;
        this.transactions = transactions;
        this.userSqlRepository = userSqlRepository;
        this.teamMembers = teamMembers;
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

    @Override
    @Transactional(readOnly = true)
    public UserDto getUser(UUID userId) {
        return userSqlRepository.findProfile(userId).map(this::toDto)
                .orElseThrow(UserNotFoundException::new);
    }

    @Override
    @Transactional
    public UserDto updateUser(UUID userId, UpdateUserRequestDto request) {
        try {
            if (userSqlRepository.update(userId, request) == 0) {
                throw new UserNotFoundException();
            }
        } catch (DataIntegrityViolationException failure) {
            if (isConstraintViolation(failure, USERNAME_UNIQUE_INDEX)) {
                throw new UsernameAlreadyExistsException();
            }
            throw failure;
        }
        LOGGER.info("event=ACCOUNT_UPDATED user_id={}", userId);
        return getUser(userId);
    }

    @Override
    @Transactional
    public void deleteUser(UUID userId) {
        teamMembers.lockAllForUser(userId);
        if (teamMembers.isSoleAdminOfAnyTeam(userId)) {
            throw new TeamMembershipConflictException(
                    "Transfer team administration before deleting this account");
        }
        if (userSqlRepository.delete(userId) == 0) {
            throw new UserNotFoundException();
        }
        LOGGER.info("event=ACCOUNT_DELETED user_id={}", userId);
    }

    private UserDto toDto(UserSqlRepository.UserProfile profile) {
        UserDto dto = new UserDto();
        dto.setFirstName(profile.firstName());
        dto.setMiddleName(profile.middleName());
        dto.setLastName(profile.lastName());
        dto.setEmail(profile.email());
        dto.setUsername(profile.username());
        dto.setEmailVerified(profile.emailVerified());
        dto.setCreatedAt(profile.createdAt());
        return dto;
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

    private boolean isConstraintViolation(Throwable failure, String constraint) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sqlException && "23505".equals(sqlException.getSQLState())) {
                for (Throwable detail = failure; detail != null; detail = detail.getCause()) {
                    if (detail.getMessage() != null && detail.getMessage().contains(constraint)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
