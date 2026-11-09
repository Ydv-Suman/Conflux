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
        for (String path : List.of(
                "/api/projects/{project}/teams/{team}/workstreams/{stream}/contributions/**",
                "/api/projects/{project}/teams/{team}/workstreams/{stream}/documents/{document}/history/**")) {
            registry.addMapping(path).allowedOrigins(origins.toArray(String[]::new))
                    .allowedMethods(path.contains("/history/") ? new String[]{"GET", "POST"} : new String[]{"GET"}).allowedHeaders("Authorization", "Content-Type", "Accept")
                    .allowCredentials(false).maxAge(300);
        }
    }
}
