package com.conflux.identity_service.exception;

public class IdentityAlreadyLinkedException extends RuntimeException {

    public IdentityAlreadyLinkedException(String message) {
        super(message);
    }
}
