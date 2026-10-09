package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
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
    private final ProjectService service = new ProjectService(projects);

    @Test
    void listIsScopedToAuthenticatedUser() {
        UUID actorId = UUID.randomUUID();

        service.list(actorId);

        verify(projects).findAllByCreatedByOrderByCreatedAtDesc(actorId);
    }

    @Test
    void nonOwnerCannotReadProject() {
        UUID projectId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(projects.findByProjectIdAndCreatedBy(projectId, actorId)).thenReturn(Optional.empty());

        assertThrows(ProjectNotFoundException.class, () -> service.get(actorId, projectId));
    }

    @Test
    void nonOwnerCannotUpdateProject() {
        UUID projectId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(projects.findByProjectIdAndCreatedBy(projectId, actorId)).thenReturn(Optional.empty());

        assertThrows(ProjectNotFoundException.class,
                () -> service.update(actorId, projectId, new UpdateProjectRequestDto("Renamed", null)));
        verify(projects, never()).saveAndFlush(org.mockito.ArgumentMatchers.any(Project.class));
    }
}
