package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.exception.ProjectConflictException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import com.conflux.workspaceservice.workstream.repository.WorkstreamRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.any;

class ProjectServiceTests {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectTeamRepository projectTeams = mock(ProjectTeamRepository.class);
    private final ProjectAuthorizationService authorization = mock(ProjectAuthorizationService.class);
    private final TeamAuthorizationClient identity = mock(TeamAuthorizationClient.class);
    private final WorkstreamRepository workstreams = mock(WorkstreamRepository.class);
    private final ProjectService service =
            new ProjectService(projects, projectTeams, authorization, identity, workstreams);

    @Test
    void listIsScopedToTeamsVisibleToUser() {
        UUID actorId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(authorization.teamIdsWithCapability(actorId, TeamCapability.VIEW_PROJECT))
                .thenReturn(List.of(teamId));

        service.list(actorId);

        verify(projects).findAllByCreatedByOrderByCreatedAtDesc(actorId);
        verify(projects).findAllByTeamIds(List.of(teamId));
    }

    @Test
    void listIncludesOwnedProjectsWithoutTeamMemberships() {
        UUID actorId = UUID.randomUUID();
        when(authorization.teamIdsWithCapability(actorId, TeamCapability.VIEW_PROJECT))
                .thenReturn(List.of());

        service.list(actorId);

        verify(projects).findAllByCreatedByOrderByCreatedAtDesc(actorId);
        verify(projects, never()).findAllByTeamIds(any());
    }

    @Test
    void projectIsCreatedWithoutAssigningATeam() {
        UUID actorId = UUID.randomUUID();

        service.create(actorId, new CreateProjectRequestDto("Payments", "Payment services"));

        verify(projects).saveAndFlush(any(Project.class));
        verify(projectTeams, never()).saveAndFlush(any());
        verify(authorization, never()).requireTeamCapability(
                any(), any(), any());
    }

    @Test
    void inaccessibleProjectCannotBeRead() {
        UUID projectId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        org.mockito.Mockito.doThrow(new ProjectNotFoundException()).when(authorization)
                .requireProjectCapability(actorId, projectId, TeamCapability.VIEW_PROJECT);

        assertThrows(ProjectNotFoundException.class, () -> service.get(actorId, projectId));
        verify(projects, never()).findByProjectId(projectId);
    }

    @Test
    void missingAuthorizedProjectCannotBeUpdated() {
        UUID projectId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(projects.findByProjectId(projectId)).thenReturn(Optional.empty());

        assertThrows(ProjectNotFoundException.class,
                () -> service.update(actorId, projectId, new UpdateProjectRequestDto("Renamed", null)));
        verify(authorization).requireProjectCapability(
                actorId, projectId, TeamCapability.MANAGE_PROJECT);
        verify(projects, never()).saveAndFlush(org.mockito.ArgumentMatchers.any(Project.class));
    }

    @Test
    void teamWithWorkstreamsCannotBeRemoved() {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(projects.findForUpdate(projectId)).thenReturn(Optional.of(new Project()));
        when(projectTeams.existsByProjectProjectIdAndTeamId(projectId, teamId)).thenReturn(true);
        when(workstreams.existsByProjectProjectIdAndTeamId(projectId, teamId)).thenReturn(true);

        assertThrows(ProjectConflictException.class,
                () -> service.removeTeam(actorId, projectId, teamId));

        verify(projectTeams, never()).deleteByProjectProjectIdAndTeamId(projectId, teamId);
    }

    @Test
    void lastTeamWithoutWorkstreamsCanBeRemoved() {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(projects.findForUpdate(projectId)).thenReturn(Optional.of(new Project()));
        when(projectTeams.existsByProjectProjectIdAndTeamId(projectId, teamId)).thenReturn(true);

        service.removeTeam(actorId, projectId, teamId);

        verify(projectTeams).deleteByProjectProjectIdAndTeamId(projectId, teamId);
    }
}
