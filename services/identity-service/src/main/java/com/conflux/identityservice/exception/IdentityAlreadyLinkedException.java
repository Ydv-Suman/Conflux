package com.conflux.identityservice.exception;

public class IdentityAlreadyLinkedException extends RuntimeException {

    public IdentityAlreadyLinkedException(String message) {
        super(message);
    }
}
