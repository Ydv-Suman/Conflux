package com.conflux.identityservice.user.exception;

public class UsernameAlreadyExistsException extends RuntimeException {
    public UsernameAlreadyExistsException() {
        super("Username is already in use");
    }
}
