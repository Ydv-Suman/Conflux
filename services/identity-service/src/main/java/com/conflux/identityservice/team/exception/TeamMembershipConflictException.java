package com.conflux.identityservice.team.exception;

public class TeamMembershipConflictException extends RuntimeException {
    public TeamMembershipConflictException(String message) {
        super(message);
    }
}
