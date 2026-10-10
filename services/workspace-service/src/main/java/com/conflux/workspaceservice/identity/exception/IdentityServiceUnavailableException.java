package com.conflux.workspaceservice.identity.exception;

public class IdentityServiceUnavailableException extends RuntimeException {

    public IdentityServiceUnavailableException() {
        super("Identity authorization is temporarily unavailable");
    }
}
