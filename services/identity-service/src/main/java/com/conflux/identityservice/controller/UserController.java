package com.conflux.identityservice.controller;

import com.conflux.identityservice.constants.ApplicationConstants;
import com.conflux.identityservice.dto.ApiResponseDto;
import com.conflux.identityservice.dto.RegisterUserRequestDto;
import com.conflux.identityservice.dto.ResendVerificationRequestDto;
import com.conflux.identityservice.dto.VerifyEmailRequestDto;
import com.conflux.identityservice.dto.UpdateUserRequestDto;
import com.conflux.identityservice.dto.UserDto;
import com.conflux.identityservice.service.IUserService;
import com.conflux.identityservice.service.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

@RestController
@RequestMapping("/api/users")
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

    @PostMapping(path = "/verify-email", version = "1.0")
    public ResponseEntity<Void> verifyEmail(
            @Valid @RequestBody VerifyEmailRequestDto request,
            HttpServletRequest servletRequest) {
        rateLimits.checkVerification(servletRequest.getRemoteAddr());
        userService.verifyEmail(request.token());
        return ResponseEntity.noContent().build();
    }

    @PostMapping(path = "/resend-verification", version = "1.0")
    public ResponseEntity<Void> resendVerification(
            @Valid @RequestBody ResendVerificationRequestDto request,
            HttpServletRequest servletRequest) {
        rateLimits.checkResend(request.email(), servletRequest.getRemoteAddr());
        userService.resendVerification(request.email());
        return ResponseEntity.accepted().build();
    }

    @GetMapping(path = "/me", version = "1.0")
    public UserDto getCurrentUser(@AuthenticationPrincipal Jwt jwt) {
        return userService.getUser(userId(jwt));
    }

    @PutMapping(path = "/me", version = "1.0")
    public UserDto updateCurrentUser(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateUserRequestDto request) {
        return userService.updateUser(userId(jwt), request);
    }

    @DeleteMapping(path = "/me", version = "1.0")
    public ResponseEntity<Void> deleteCurrentUser(@AuthenticationPrincipal Jwt jwt) {
        userService.deleteUser(userId(jwt));
        return ResponseEntity.noContent().build();
    }

    private UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

}
