package com.conflux.identityservice.team.exception;

public class InvitationNotFoundException extends RuntimeException {
    public InvitationNotFoundException() { super("Invitation not found"); }
}
