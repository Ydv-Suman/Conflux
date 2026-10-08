package com.conflux.identityservice.team.exception;

public class TeamAccessDeniedException extends RuntimeException {
    public TeamAccessDeniedException() {
        super("Operation is not permitted");
    }
}
