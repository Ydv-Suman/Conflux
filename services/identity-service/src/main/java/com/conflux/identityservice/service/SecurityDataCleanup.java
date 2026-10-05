package com.conflux.identityservice.service;

import com.conflux.identityservice.repository.AuthSessionRepository;
import com.conflux.identityservice.repository.EmailVerificationTokenRepository;
import com.conflux.identityservice.repository.RateLimitRepository;
import com.conflux.identityservice.repository.RevokedJwtRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class SecurityDataCleanup {

    private final RevokedJwtRepository revokedJwts;
    private final AuthSessionRepository sessions;
    private final EmailVerificationTokenRepository verificationTokens;
    private final RateLimitRepository rateLimits;

    public SecurityDataCleanup(
            RevokedJwtRepository revokedJwts,
            AuthSessionRepository sessions,
            EmailVerificationTokenRepository verificationTokens,
            RateLimitRepository rateLimits) {
        this.revokedJwts = revokedJwts;
        this.sessions = sessions;
        this.verificationTokens = verificationTokens;
        this.rateLimits = rateLimits;
    }

    @Scheduled(cron = "${app.security-cleanup-cron:0 0 * * * *}")
    @Transactional
    public void clean() {
        revokedJwts.deleteExpired();
        sessions.deleteExpiredOrRevoked();
        verificationTokens.deleteExpiredOrConsumed();
        rateLimits.deleteOlderThan(60 * 60);
    }
}
