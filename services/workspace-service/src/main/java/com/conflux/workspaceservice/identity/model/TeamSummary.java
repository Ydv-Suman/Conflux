package com.conflux.workspaceservice.identity.model;

import java.util.UUID;

public record TeamSummary(UUID teamId, String name, String description) {
}
