package com.conflux.identityservice.service.impl;

import com.conflux.identityservice.dto.RegisterUserRequestDto;
import com.conflux.identityservice.service.EmailVerificationService;
import com.conflux.identityservice.service.IUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class UserRegistrationIntegrationTests {

    @Autowired
    private IUserService userService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private EmailVerificationService emailVerificationService;

    private String username;

    @AfterEach
    void cleanUp() {
        if (username != null) {
            jdbcTemplate.update("DELETE FROM users WHERE username = ?", username);
        }
    }

    @Test
    void duplicateRegistrationIsHiddenWithoutPoisoningTheTransaction() {
        username = "user-" + UUID.randomUUID().toString().substring(0, 12);
        RegisterUserRequestDto request = new RegisterUserRequestDto(
                "First", null, "Last", username, username + "@example.com",
                "LongPassword1!", "LongPassword1!");

        userService.registerUser(request);

        assertDoesNotThrow(() -> userService.registerUser(request));
        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE username = ?", Integer.class, username));
    }
}
