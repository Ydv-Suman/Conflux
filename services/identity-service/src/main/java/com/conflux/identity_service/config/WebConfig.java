package com.conflux.identity_service.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.config.annotation.ApiVersionConfigurer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import static com.conflux.identity_service.security.PathConfig.API_PREFIX;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        configurer.addPathPrefix(API_PREFIX, clazz -> true);
    }

    @Override
    public void configureApiVersioning(ApiVersionConfigurer configurer) {
        configurer.useMediaTypeParameter(MediaType.parseMediaType("application/vnd.conflux+json"), "v")
                .addSupportedVersions("1.0")
                .setDefaultVersion("1.0");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping(API_PREFIX + "/**")
                .allowedOriginPatterns("http://localhost:*")
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

}
