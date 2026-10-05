package com.conflux.identityservice.security;

import com.conflux.identityservice.config.WebConfig;
import com.conflux.identityservice.controller.UserController;
import com.conflux.identityservice.controller.AuthController;
import com.conflux.identityservice.service.AuthService;
import com.conflux.identityservice.service.IUserService;
import com.conflux.identityservice.service.RateLimitService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

import static com.conflux.identityservice.security.PathConfig.USERS_API;
import static com.conflux.identityservice.security.PathConfig.LOGOUT_API;
import jakarta.servlet.http.Cookie;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;

@WebMvcTest({UserController.class, AuthController.class})
@Import({ServiceSecurityConfig.class, PathConfig.class, WebConfig.class,
        ServiceSecurityConfigTests.StubConfig.class})
class ServiceSecurityConfigTests {

    @Autowired
    private MockMvc mvc;

    @Test
    void registrationDoesNotRequireCsrfToken() throws Exception {
        mvc.perform(post(USERS_API)
                        .contentType("application/json")
                        .content("""
                                {"firstName":"First","lastName":"Last","username":"test.user",
                                 "email":"user@example.com","password":"LongPassword1!",
                                 "confirmPassword":"LongPassword1!"}
                                """))
                .andExpect(status().isAccepted());
    }

    @Test
    void invalidRegistrationReturnsBadRequestWithoutEchoingPassword() throws Exception {
        mvc.perform(post(USERS_API)
                        .contentType("application/json")
                        .content("""
                                {"firstName":"First","lastName":"Last","username":"test.user",
                                 "email":"user@example.com","password":"Short1!",
                                 "confirmPassword":"Short1!"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(not(containsString("Short1!"))));
    }

    @Test
    void cookieLogoutIgnoresAnExpiredBearerToken() throws Exception {
        mvc.perform(post(LOGOUT_API)
                        .header("Origin", "http://localhost:5173")
                        .header("Authorization", "Bearer expired-token")
                        .cookie(new Cookie("conflux_refresh", "opaque-refresh-token")))
                .andExpect(status().isNoContent());
    }

    @TestConfiguration
    static class StubConfig {

        @Bean
        IUserService userService() {
            return new IUserService() {
                @Override
                public void registerUser(
                        com.conflux.identityservice.dto.RegisterUserRequestDto request) {
                }

                @Override
                public void verifyEmail(String token) {
                }

                @Override
                public void resendVerification(String email) {
                }
            };
        }

        @Bean
        RateLimitService rateLimitService() {
            return mock(RateLimitService.class);
        }

        @Bean
        AuthService authService() {
            return mock(AuthService.class);
        }

        @Bean
        JwtDecoder jwtDecoder() {
            return token -> null;
        }
    }
}
