package com.conflux.identity_service.controller;

import com.conflux.identity_service.Constants.ApplicationConstants;
import com.conflux.identity_service.dto.ApiResponseDto;
import com.conflux.identity_service.dto.RegisterUserRequestDto;
import com.conflux.identity_service.service.IUserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/users")
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
                .status(HttpStatus.CREATED)
                .body(new ApiResponseDto<>(ApplicationConstants.STATUS_201, ApplicationConstants.MESSAGE_201, null));
    }

}
