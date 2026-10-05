package com.conflux.identityservice.service;

import com.conflux.identityservice.exception.RateLimitExceededException;
import com.conflux.identityservice.repository.RateLimitRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

@Service
public class RateLimitService {

    private static final Logger LOGGER = LoggerFactory.getLogger(RateLimitService.class);
    private static final int LOGIN_ACCOUNT_MAXIMUM = 5;
    private static final long LOGIN_WINDOW_SECONDS = 5 * 60;
    private static final long LOGIN_COOLDOWN_SECONDS = 60;
    private static final int LOGIN_IP_MAXIMUM = 30;

    private final RateLimitRepository repository;

    public RateLimitService(RateLimitRepository repository) {
        this.repository = repository;
    }

    public void checkLogin(String usernameOrEmail, String clientIp) {
        String accountKey = key("login-account", usernameOrEmail);
        long accountRetryAfter = repository.loginCooldownRemaining(
                accountKey, LOGIN_ACCOUNT_MAXIMUM, LOGIN_WINDOW_SECONDS, LOGIN_COOLDOWN_SECONDS);
        if (accountRetryAfter > 0) {
            LOGGER.warn("event=AUTH_RATE_LIMITED limit=login_account retry_after_seconds={}", accountRetryAfter);
            throw new RateLimitExceededException(accountRetryAfter);
        }

        String ipKey = key("login-ip", clientIp);
        if (!repository.consume(ipKey, LOGIN_IP_MAXIMUM, LOGIN_WINDOW_SECONDS)) {
            long retryAfter = repository.retryAfter(ipKey, LOGIN_WINDOW_SECONDS);
            LOGGER.warn("event=AUTH_RATE_LIMITED limit=login_ip retry_after_seconds={}", retryAfter);
            throw new RateLimitExceededException(retryAfter);
        }
    }

    public void recordLoginFailure(String usernameOrEmail) {
        repository.record(key("login-account", usernameOrEmail));
    }

    public void clearLoginFailures(String usernameOrEmail) {
        repository.clear(key("login-account", usernameOrEmail));
    }

    public void checkRegistration(String clientIp) {
        require(repository.consume(key("register-ip", clientIp), 5, 60 * 60), "registration_ip");
    }

    public void checkResend(String email, String clientIp) {
        require(repository.consume(key("resend-ip", clientIp), 10, 60 * 60), "verification_resend_ip");
        require(repository.consume(key("resend-email", email), 3, 60 * 60), "verification_resend_email");
    }

    public void checkVerification(String clientIp) {
        require(repository.consume(key("verify-ip", clientIp), 20, 60), "verification_ip");
    }

    public void checkRefresh(String refreshToken, String clientIp) {
        require(repository.consume(key("refresh-ip", clientIp), 30, 60), "refresh_ip");
        require(repository.consume(key("refresh-token", refreshToken), 30, 60), "refresh_token");
    }

    private void require(boolean allowed, String limit) {
        if (!allowed) {
            LOGGER.warn("event=AUTH_RATE_LIMITED limit={}", limit);
            throw new RateLimitExceededException();
        }
    }

    private String key(String type, String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((type + ':' + value).getBytes(StandardCharsets.UTF_8));
            return type + ':' + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
