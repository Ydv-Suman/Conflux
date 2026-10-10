package com.conflux.workspaceservice.identity.client;

import com.conflux.workspaceservice.identity.model.TeamAuthorization;

import java.util.UUID;

public interface TeamAuthorizationClient {

    TeamAuthorization getAuthorization(UUID userId, UUID teamId);
}
