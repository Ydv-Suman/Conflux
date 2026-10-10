package com.conflux.workspaceservice.identity.model;

import java.util.Set;
import java.util.UUID;

public record TeamMembership(UUID teamId, Set<TeamCapability> capabilities) {

    public TeamMembership {
        capabilities = Set.copyOf(capabilities);
    }

    public boolean has(TeamCapability capability) {
        return capabilities.contains(capability);
    }
}
