package com.conflux.workspaceservice.project.exception;

public class ProjectNotFoundException extends RuntimeException {

    public ProjectNotFoundException() {
        super("Project not found");
    }
}
