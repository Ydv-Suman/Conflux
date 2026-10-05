package com.conflux.identityservice.security;

import com.conflux.identityservice.repository.RevokedJwtRepository;
import com.conflux.identityservice.repository.AuthSessionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.UUID;

@Configuration
public class JwtConfig {

    @Bean
    JwtEncoder jwtEncoder(
            @Value("${app.jwt.public-key}") Resource publicKeyResource,
            @Value("${app.jwt.private-key}") Resource privateKeyResource) {
        return NimbusJwtEncoder.withKeyPair(
                readPublicKey(publicKeyResource), readPrivateKey(privateKeyResource)).build();
    }

    @Bean
    JwtDecoder jwtDecoder(
            @Value("${app.jwt.public-key}") Resource publicKeyResource,
            @Value("${app.jwt.issuer}") String issuer,
            @Value("${app.jwt.audience}") String audience,
            RevokedJwtRepository revokedJwts,
            AuthSessionRepository sessions) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(readPublicKey(publicKeyResource)).build();
        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> jwt.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Invalid audience", null));
        OAuth2TokenValidator<Jwt> revocationValidator = jwt -> {
            try {
                UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
                return jwt.getId() != null
                        && !revokedJwts.exists(UUID.fromString(jwt.getId()))
                        && sessions.isActive(sessionId)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(
                                new OAuth2Error("invalid_token", "Token has been revoked", null));
            } catch (IllegalArgumentException failure) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "Invalid token identifier", null));
            }
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer), audienceValidator, revocationValidator));
        return decoder;
    }

    private RSAPublicKey readPublicKey(Resource resource) {
        try {
            return (RSAPublicKey) keyFactory().generatePublic(
                    new X509EncodedKeySpec(readPem(resource, "PUBLIC KEY")));
        } catch (InvalidKeySpecException failure) {
            throw new IllegalStateException("Invalid JWT public key", failure);
        }
    }

    private RSAPrivateKey readPrivateKey(Resource resource) {
        try {
            return (RSAPrivateKey) keyFactory().generatePrivate(
                    new PKCS8EncodedKeySpec(readPem(resource, "PRIVATE KEY")));
        } catch (InvalidKeySpecException failure) {
            throw new IllegalStateException("Invalid JWT private key", failure);
        }
    }

    private KeyFactory keyFactory() {
        try {
            return KeyFactory.getInstance("RSA");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private byte[] readPem(Resource resource, String type) {
        try {
            String pem = new String(resource.getInputStream().readAllBytes(), StandardCharsets.US_ASCII)
                    .replace("-----BEGIN " + type + "-----", "")
                    .replace("-----END " + type + "-----", "")
                    .replaceAll("\\s", "");
            return Base64.getDecoder().decode(pem);
        } catch (IOException | IllegalArgumentException failure) {
            throw new IllegalStateException("Unable to read JWT " + type.toLowerCase(), failure);
        }
    }
}
