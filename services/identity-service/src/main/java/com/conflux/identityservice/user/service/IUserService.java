package com.conflux.identityservice.user.service;

import com.conflux.identityservice.user.dto.RegisterUserRequestDto;
import com.conflux.identityservice.user.dto.UpdateUserRequestDto;
import com.conflux.identityservice.user.dto.UserDto;

import java.util.UUID;

public interface IUserService {

    void registerUser(RegisterUserRequestDto registerRequestDto);

    void verifyEmail(String token);

    void resendVerification(String email);

    UserDto getUser(UUID userId);

    UserDto updateUser(UUID userId, UpdateUserRequestDto request);

    void deleteUser(UUID userId);
}
