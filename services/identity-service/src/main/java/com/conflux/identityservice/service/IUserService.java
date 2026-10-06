package com.conflux.identityservice.service;

import com.conflux.identityservice.dto.RegisterUserRequestDto;
import com.conflux.identityservice.dto.UpdateUserRequestDto;
import com.conflux.identityservice.dto.UserDto;

import java.util.UUID;

public interface IUserService {

    void registerUser(RegisterUserRequestDto registerRequestDto);

    void verifyEmail(String token);

    void resendVerification(String email);

    UserDto getUser(UUID userId);

    UserDto updateUser(UUID userId, UpdateUserRequestDto request);

    void deleteUser(UUID userId);
}
