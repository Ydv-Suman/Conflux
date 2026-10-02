package com.conflux.identity_service.security;

import com.conflux.identity_service.config.WebConfig;
import com.conflux.identity_service.controller.UserController;
import com.conflux.identity_service.service.IUserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static com.conflux.identity_service.security.PathConfig.USERS_API;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UserController.class)
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

    @TestConfiguration
    static class StubConfig {

        @Bean
        IUserService userService() {
            return new IUserService() {
                @Override
                public void registerUser(
                        com.conflux.identity_service.dto.RegisterUserRequestDto request) {
                }

                @Override
                public void verifyEmail(String token) {
                }

                @Override
                public void resendVerification(String email) {
                }
            };
        }
    }
}
