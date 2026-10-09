package com.conflux.workspaceservice.workstream.exception;

public class WorkstreamNotFoundException extends RuntimeException {

    public WorkstreamNotFoundException() {
        super("Workstream not found");
    }
}
