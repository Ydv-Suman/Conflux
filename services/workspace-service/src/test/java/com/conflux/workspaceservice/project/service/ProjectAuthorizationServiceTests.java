package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.identity.model.TeamAuthorization;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProjectAuthorizationServiceTests {

    private final ProjectTeamRepository projectTeams = mock(ProjectTeamRepository.class);
    private final TeamAuthorizationClient identity = mock(TeamAuthorizationClient.class);
    private final ProjectAuthorizationService authorization =
            new ProjectAuthorizationService(projectTeams, identity);

    @Test
    void teamMemberWithCapabilityIsAllowed() {
        UUID actorId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(identity.getAuthorization(actorId, teamId)).thenReturn(
                new TeamAuthorization(true, Set.of(TeamCapability.VIEW_PROJECT)));

        assertDoesNotThrow(() -> authorization.requireTeamCapability(
                actorId, teamId, TeamCapability.VIEW_PROJECT));
    }

    @Test
    void nonMemberIsHiddenAsNotFound() {
        UUID actorId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(identity.getAuthorization(actorId, teamId))
                .thenReturn(new TeamAuthorization(false, Set.of()));

        assertThrows(ProjectNotFoundException.class, () -> authorization.requireTeamCapability(
                actorId, teamId, TeamCapability.VIEW_PROJECT));
    }

    @Test
    void capabilityFromAnyAssignedTeamAllowsProjectAccess() {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID firstTeam = UUID.randomUUID();
        UUID secondTeam = UUID.randomUUID();
        when(projectTeams.findTeamIdsByProjectId(projectId))
                .thenReturn(List.of(firstTeam, secondTeam));
        when(identity.getAuthorization(actorId, firstTeam))
                .thenReturn(new TeamAuthorization(true, Set.of()));
        when(identity.getAuthorization(actorId, secondTeam)).thenReturn(
                new TeamAuthorization(true, Set.of(TeamCapability.CREATE_WORKSTREAM)));

        assertDoesNotThrow(() -> authorization.requireProjectCapability(
                actorId, projectId, TeamCapability.CREATE_WORKSTREAM));
    }

    @Test
    void missingCapabilityIsRejected() {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(projectTeams.findTeamIdsByProjectId(projectId)).thenReturn(List.of(teamId));
        when(identity.getAuthorization(actorId, teamId)).thenReturn(
                new TeamAuthorization(true, Set.of(TeamCapability.VIEW_PROJECT)));

        assertThrows(ProjectNotFoundException.class, () -> authorization.requireProjectCapability(
                actorId, projectId, TeamCapability.CREATE_PROJECT));
    }
}
