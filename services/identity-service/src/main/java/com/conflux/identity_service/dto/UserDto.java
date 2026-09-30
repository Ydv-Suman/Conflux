package com.conflux.identity_service.dto;

import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
public class UserDto {
    private String firstName;
    private String middleName;
    private String lastName;
    private String email;
    private String username;
    private boolean emailVerified;
    private Instant createdAt;
}
