package com.conflux.identityservice.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class JwtService {

    private final JwtEncoder encoder;
    private final Duration accessTtl;
    private final String issuer;
    private final String audience;

    public JwtService(
            JwtEncoder encoder,
            @Value("${app.jwt.access-ttl}") Duration accessTtl,
            @Value("${app.jwt.issuer}") String issuer,
            @Value("${app.jwt.audience}") String audience) {
        this.encoder = encoder;
        this.accessTtl = accessTtl;
        this.issuer = issuer;
        this.audience = audience;
    }

    public AccessToken issue(UUID userId, String username, UUID sessionId) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(accessTtl);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(java.util.List.of(audience))
                .subject(userId.toString())
                .id(UUID.randomUUID().toString())
                .issuedAt(now)
                .notBefore(now)
                .expiresAt(expiresAt)
                .claim("username", username)
                .claim("sid", sessionId.toString())
                .build();
        String token = encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
        return new AccessToken(token, accessTtl.toSeconds(), expiresAt);
    }

    public record AccessToken(String value, long expiresIn, Instant expiresAt) {
    }
}
