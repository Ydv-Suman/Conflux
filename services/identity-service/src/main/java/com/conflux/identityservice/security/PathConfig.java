package com.conflux.identityservice.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class PathConfig {

    @Bean(name = "publicPaths")
    public List<String> publicPaths() {
        return List.of(
                "/api/users",
                "/api/users/verify-email",
                "/api/users/resend-verification",
                "/api/auth/login",
                "/api/auth/refresh",
                "/api/auth/logout");
    }
}
