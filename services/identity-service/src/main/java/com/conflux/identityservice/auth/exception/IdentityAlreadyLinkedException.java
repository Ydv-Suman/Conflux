package com.conflux.identityservice.auth.exception;

public class IdentityAlreadyLinkedException extends RuntimeException {

    public IdentityAlreadyLinkedException(String message) {
        super(message);
    }
}
