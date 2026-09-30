package com.conflux.identity_service.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class PathsConfig {

    @Bean(name="publicPaths")
    public List<String> publicpaths(){
        return List.of("/api/users");
    }

}
