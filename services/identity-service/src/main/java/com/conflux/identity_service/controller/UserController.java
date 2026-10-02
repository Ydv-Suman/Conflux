package com.conflux.identity_service.controller;

import com.conflux.identity_service.Constants.ApplicationConstants;
import com.conflux.identity_service.dto.ApiResponseDto;
import com.conflux.identity_service.dto.RegisterUserRequestDto;
import com.conflux.identity_service.dto.ResendVerificationRequestDto;
import com.conflux.identity_service.dto.VerifyEmailRequestDto;
import com.conflux.identity_service.service.IUserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.conflux.identity_service.security.PathConfig.USERS;
import static com.conflux.identity_service.security.PathConfig.RESEND_VERIFICATION;
import static com.conflux.identity_service.security.PathConfig.VERIFY_EMAIL;

@RestController
@RequestMapping(USERS)
public class UserController {

    private final IUserService userService;

    public UserController(IUserService userService) {
        this.userService = userService;
    }

    @PostMapping(version = "1.0")
    public ResponseEntity<ApiResponseDto<Void>> registerUser(
            @Valid @RequestBody RegisterUserRequestDto registerRequestDto) {
        userService.registerUser(registerRequestDto);
        return ResponseEntity
                .status(HttpStatus.ACCEPTED)
                .body(new ApiResponseDto<>(ApplicationConstants.STATUS_202, ApplicationConstants.MESSAGE_202, null));
    }

    @PostMapping(path = VERIFY_EMAIL, version = "1.0")
    public ResponseEntity<Void> verifyEmail(@Valid @RequestBody VerifyEmailRequestDto request) {
        userService.verifyEmail(request.token());
        return ResponseEntity.noContent().build();
    }

    @PostMapping(path = RESEND_VERIFICATION, version = "1.0")
    public ResponseEntity<Void> resendVerification(
            @Valid @RequestBody ResendVerificationRequestDto request) {
        userService.resendVerification(request.email());
        return ResponseEntity.accepted().build();
    }

}
