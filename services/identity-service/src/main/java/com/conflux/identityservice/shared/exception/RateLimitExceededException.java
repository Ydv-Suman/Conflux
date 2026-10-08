package com.conflux.identityservice.shared.exception;

public class RateLimitExceededException extends RuntimeException {
    private final long retryAfterSeconds;

    public RateLimitExceededException() {
        this(60);
    }

    public RateLimitExceededException(long retryAfterSeconds) {
        super("Too many requests. Try again later.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
