package com.conflux.identityservice.controller;

import com.conflux.identityservice.constants.ApplicationConstants;
import com.conflux.identityservice.dto.ApiResponseDto;
import com.conflux.identityservice.dto.RegisterUserRequestDto;
import com.conflux.identityservice.dto.ResendVerificationRequestDto;
import com.conflux.identityservice.dto.VerifyEmailRequestDto;
import com.conflux.identityservice.service.IUserService;
import com.conflux.identityservice.service.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.conflux.identityservice.security.PathConfig.USERS;
import static com.conflux.identityservice.security.PathConfig.RESEND_VERIFICATION;
import static com.conflux.identityservice.security.PathConfig.VERIFY_EMAIL;

@RestController
@RequestMapping(USERS)
public class UserController {

    private final IUserService userService;
    private final RateLimitService rateLimits;

    public UserController(IUserService userService, RateLimitService rateLimits) {
        this.userService = userService;
        this.rateLimits = rateLimits;
    }

    @PostMapping(version = "1.0")
    public ResponseEntity<ApiResponseDto<Void>> registerUser(
            @Valid @RequestBody RegisterUserRequestDto registerRequestDto,
            HttpServletRequest request) {
        rateLimits.checkRegistration(request.getRemoteAddr());
        userService.registerUser(registerRequestDto);
        return ResponseEntity
                .status(HttpStatus.ACCEPTED)
                .body(new ApiResponseDto<>(ApplicationConstants.STATUS_202, ApplicationConstants.MESSAGE_202, null));
    }

    @PostMapping(path = VERIFY_EMAIL, version = "1.0")
    public ResponseEntity<Void> verifyEmail(
            @Valid @RequestBody VerifyEmailRequestDto request,
            HttpServletRequest servletRequest) {
        rateLimits.checkVerification(servletRequest.getRemoteAddr());
        userService.verifyEmail(request.token());
        return ResponseEntity.noContent().build();
    }

    @PostMapping(path = RESEND_VERIFICATION, version = "1.0")
    public ResponseEntity<Void> resendVerification(
            @Valid @RequestBody ResendVerificationRequestDto request,
            HttpServletRequest servletRequest) {
        rateLimits.checkResend(request.email(), servletRequest.getRemoteAddr());
        userService.resendVerification(request.email());
        return ResponseEntity.accepted().build();
    }

}
