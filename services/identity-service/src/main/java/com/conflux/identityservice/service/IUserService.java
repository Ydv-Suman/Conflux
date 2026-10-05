package com.conflux.identityservice.service;

import com.conflux.identityservice.dto.RegisterUserRequestDto;

public interface IUserService {

    void registerUser(RegisterUserRequestDto registerRequestDto);

    void verifyEmail(String token);

    void resendVerification(String email);
}
