package com.conflux.identity_service.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class PathConfig {

    public static final String API_PREFIX = "/api";
    public static final String USERS = "/users";
    public static final String USERS_API = API_PREFIX + USERS;
    public static final String VERIFY_EMAIL = "/verify-email";
    public static final String RESEND_VERIFICATION = "/resend-verification";
    public static final String VERIFY_EMAIL_API = USERS_API + VERIFY_EMAIL;
    public static final String RESEND_VERIFICATION_API = USERS_API + RESEND_VERIFICATION;

    @Bean(name = "publicPaths")
    public List<String> publicPaths() {
        return List.of(USERS_API, VERIFY_EMAIL_API, RESEND_VERIFICATION_API);
    }

}
