package com.conflux.workspaceservice.identity.model;

import java.util.Set;

public record TeamAuthorization(boolean member, Set<TeamCapability> capabilities) {

    public TeamAuthorization {
        capabilities = Set.copyOf(capabilities);
    }

    public boolean has(TeamCapability capability) {
        return member && capabilities.contains(capability);
    }
}
