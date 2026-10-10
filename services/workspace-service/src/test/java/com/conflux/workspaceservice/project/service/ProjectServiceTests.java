package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectServiceTests {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectTeamRepository projectTeams = mock(ProjectTeamRepository.class);
    private final ProjectAuthorizationService authorization = mock(ProjectAuthorizationService.class);
    private final ProjectService service = new ProjectService(projects, projectTeams, authorization);

    @Test
    void listIsScopedToVerifiedTeam() {
        UUID actorId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();

        service.list(actorId, teamId);

        verify(authorization).requireTeamCapability(actorId, teamId, TeamCapability.VIEW_PROJECT);
        verify(projects).findAllByTeamId(teamId);
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
        verify(projects, never()).saveAndFlush(org.mockito.ArgumentMatchers.any(Project.class));
    }
}
