package com.conflux.workspaceservice.workstream.service;

import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.service.ProjectAuthorizationService;
import com.conflux.workspaceservice.workstream.dto.UpdateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.entity.Workstream;
import com.conflux.workspaceservice.workstream.entity.WorkstreamStatus;
import com.conflux.workspaceservice.workstream.exception.WorkstreamConflictException;
import com.conflux.workspaceservice.workstream.exception.WorkstreamNotFoundException;
import com.conflux.workspaceservice.workstream.repository.WorkstreamRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkstreamServiceTests {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final WorkstreamRepository workstreams = mock(WorkstreamRepository.class);
    private final ProjectAuthorizationService authorization = mock(ProjectAuthorizationService.class);
    private final WorkstreamService service = new WorkstreamService(projects, workstreams, authorization);

    @Test
    void nonOwnerCannotListProjectWorkstreams() {
        UUID projectId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        org.mockito.Mockito.doThrow(new ProjectNotFoundException()).when(authorization)
                .requireProjectCapability(actorId, projectId,
                        com.conflux.workspaceservice.identity.model.TeamCapability.VIEW_PROJECT);

        assertThrows(ProjectNotFoundException.class, () -> service.list(actorId, projectId));
        verify(workstreams, never())
                .findAllByProjectProjectIdOrderByCreatedAtDesc(projectId);
    }

    @Test
    void nonOwnerCannotUpdateWorkstream() {
        UUID projectId = UUID.randomUUID();
        UUID workstreamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(workstreams.findForUpdate(workstreamId, projectId)).thenReturn(Optional.empty());

        assertThrows(WorkstreamNotFoundException.class,
                () -> service.update(actorId, projectId, workstreamId,
                        new UpdateWorkstreamRequestDto("Renamed")));
        verify(workstreams, never()).save(org.mockito.ArgumentMatchers.any(Workstream.class));
    }

    @Test
    void invalidLifecycleTransitionIsRejected() {
        UUID projectId = UUID.randomUUID();
        UUID workstreamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workstream workstream = workstream(projectId, workstreamId, actorId, WorkstreamStatus.CREATED);
        when(workstreams.findForUpdate(workstreamId, projectId))
                .thenReturn(Optional.of(workstream));

        assertThrows(WorkstreamConflictException.class,
                () -> service.updateStatus(
                        actorId, projectId, workstreamId, WorkstreamStatus.READY_TO_MERGE));
        verify(workstreams, never()).save(workstream);
    }

    @Test
    void validLifecycleTransitionIsPersisted() {
        UUID projectId = UUID.randomUUID();
        UUID workstreamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workstream workstream = workstream(projectId, workstreamId, actorId, WorkstreamStatus.CREATED);
        when(workstreams.findForUpdate(workstreamId, projectId))
                .thenReturn(Optional.of(workstream));

        service.updateStatus(actorId, projectId, workstreamId, WorkstreamStatus.ACTIVE);

        assertEquals(WorkstreamStatus.ACTIVE, workstream.getStatus());
        verify(workstreams).save(workstream);
    }

    @Test
    void mergedWorkstreamCannotBeRenamed() {
        UUID projectId = UUID.randomUUID();
        UUID workstreamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workstream workstream = workstream(projectId, workstreamId, actorId, WorkstreamStatus.MERGED);
        when(workstreams.findForUpdate(workstreamId, projectId))
                .thenReturn(Optional.of(workstream));

        assertThrows(WorkstreamConflictException.class,
                () -> service.update(actorId, projectId, workstreamId,
                        new UpdateWorkstreamRequestDto("Renamed")));
        verify(workstreams, never()).save(workstream);
    }

    @Test
    void publicLifecycleCannotClaimMergeCompletion() {
        UUID projectId = UUID.randomUUID();
        UUID workstreamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workstream workstream = workstream(
                projectId, workstreamId, actorId, WorkstreamStatus.READY_TO_MERGE);
        when(workstreams.findForUpdate(workstreamId, projectId))
                .thenReturn(Optional.of(workstream));

        assertThrows(WorkstreamConflictException.class,
                () -> service.updateStatus(actorId, projectId, workstreamId, WorkstreamStatus.MERGED));
        verify(workstreams, never()).save(workstream);
    }

    private Workstream workstream(
            UUID projectId, UUID workstreamId, UUID actorId, WorkstreamStatus status) {
        Project project = new Project();
        project.setProjectId(projectId);
        project.setCreatedBy(actorId);
        Workstream workstream = new Workstream();
        workstream.setWorkstreamId(workstreamId);
        workstream.setProject(project);
        workstream.setName("Authentication");
        workstream.setBranchName("feature/authentication");
        workstream.setBaseRevision("abcdef1");
        workstream.setCurrentRevision("abcdef1");
        workstream.setStatus(status);
        workstream.setCreatedBy(actorId);
        return workstream;
    }
}
