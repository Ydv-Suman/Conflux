package com.conflux.workspaceservice.identity.client;

import com.conflux.workspaceservice.identity.model.TeamAuthorization;
import com.conflux.workspaceservice.identity.model.TeamMembership;
import com.conflux.workspaceservice.identity.model.TeamSummary;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface TeamAuthorizationClient {

    TeamAuthorization getAuthorization(UUID userId, UUID teamId);

    List<TeamMembership> listMemberships(UUID userId);

    List<TeamSummary> getTeamSummaries(Collection<UUID> teamIds);
}
