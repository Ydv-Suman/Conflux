package com.conflux.identity_service.service;

import com.conflux.identity_service.dto.RegisterUserRequestDto;

public interface IUserService {

    void registerUser(RegisterUserRequestDto registerRequestDto);

    void verifyEmail(String token);

    void resendVerification(String email);
}
