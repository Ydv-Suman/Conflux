package com.conflux.identity_service.service.impl;

import com.conflux.identity_service.Constants.ApplicationConstants;
import com.conflux.identity_service.dto.RegisterUserRequestDto;
import com.conflux.identity_service.entity.User;
import com.conflux.identity_service.exception.PasswordMismatchException;
import com.conflux.identity_service.repository.UserRepository;
import com.conflux.identity_service.service.IUserService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.sql.SQLException;
import java.util.Locale;

@Service
public class UserServiceImpl implements IUserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;


    public UserServiceImpl(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }


    @Override
    public void registerUser(RegisterUserRequestDto registerRequestDto) {
        validatePasswordConfirmation(registerRequestDto.password(), registerRequestDto.confirmPassword());

        User user = new User();
        user.setFirstName(registerRequestDto.firstName());
        user.setMiddleName(registerRequestDto.middleName());
        user.setLastName(registerRequestDto.lastName());
        user.setUsername(normalize(registerRequestDto.username()));
        user.setEmail(normalize(registerRequestDto.email()));
        user.setPassword(passwordEncoder.encode(registerRequestDto.password()));

        try {
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException failure) {
            if (!isUniqueViolation(failure)) {
                throw failure;
            }
            // The response intentionally does not reveal whether the account exists.
        }
    }

    private void validatePasswordConfirmation(String password, String confirmPassword) {
        if (!password.equals(confirmPassword)) {
            throw new PasswordMismatchException(ApplicationConstants.PASSWORD_MISMATCH);
        }
    }

    private String normalize(String value) {
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

    private boolean isUniqueViolation(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sqlException
                    && "23505".equals(sqlException.getSQLState())) {
                return true;
            }
        }
        return false;
    }
}
