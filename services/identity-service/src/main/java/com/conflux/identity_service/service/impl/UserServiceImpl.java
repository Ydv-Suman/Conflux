package com.conflux.identity_service.service.impl;

import com.conflux.identity_service.Constants.ApplicationConstants;
import com.conflux.identity_service.dto.RegisterUserRequestDto;
import com.conflux.identity_service.entity.User;
import com.conflux.identity_service.exception.EmailAlreadyExistsException;
import com.conflux.identity_service.exception.PasswordMismatchException;
import com.conflux.identity_service.exception.UsernameAlreadyExistsException;
import com.conflux.identity_service.repository.UserRepository;
import com.conflux.identity_service.service.IUserService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    @Transactional
    public void registerUser(RegisterUserRequestDto registerRequestDto) {
        validatePasswordConfirmation(registerRequestDto.password(), registerRequestDto.confirmPassword());
        validateUniqueUser(registerRequestDto.username(), registerRequestDto.email());

        User user = new User();
        user.setFirstName(registerRequestDto.firstName());
        user.setMiddleName(registerRequestDto.middleName());
        user.setLastName(registerRequestDto.lastName());
        user.setUsername(registerRequestDto.username());
        user.setEmail(registerRequestDto.email());
        user.setPassword(passwordEncoder.encode(registerRequestDto.password()));

        userRepository.save(user);

    }

    private void validatePasswordConfirmation(String password, String confirmPassword) {
        if (!password.equals(confirmPassword)) {
            throw new PasswordMismatchException(ApplicationConstants.PASSWORD_MISMATCH);
        }
    }

    private void validateUniqueUser(String username, String email) {
        if (userRepository.existsByUsername(username)) {
            throw new UsernameAlreadyExistsException(ApplicationConstants.USERNAME_TAKEN);
        }

        if (userRepository.existsByEmail(email)) {
            throw new EmailAlreadyExistsException(ApplicationConstants.EMAIL_REGISTERED);
        }


    }
}
