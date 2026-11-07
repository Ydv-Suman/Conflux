package com.conflux.collaborationservice.shared;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.config.CorsRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;

@Configuration
public class ReportingWebConfig implements WebFluxConfigurer {
    private final List<String> origins;
    public ReportingWebConfig(@Value("${app.cors.allowed-origins}") String allowedOrigins) {
        origins = Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toList();
        if (origins.isEmpty() || origins.contains("*")) throw new IllegalArgumentException("Explicit CORS origins required");
    }
    @Override public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/projects/{project}/teams/{team}/workstreams/{stream}/contributions/**").allowedOrigins(origins.toArray(String[]::new))
                .allowedMethods("GET").allowedHeaders("Authorization", "Content-Type", "Accept")
                .allowCredentials(false).maxAge(300);
    }
}
