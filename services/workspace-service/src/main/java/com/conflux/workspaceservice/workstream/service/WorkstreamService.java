package com.conflux.workspaceservice.workstream.service;

import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.workstream.dto.CreateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.dto.UpdateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.dto.WorkstreamDto;
import com.conflux.workspaceservice.workstream.entity.Workstream;
import com.conflux.workspaceservice.workstream.entity.WorkstreamStatus;
import com.conflux.workspaceservice.workstream.exception.WorkstreamConflictException;
import com.conflux.workspaceservice.workstream.exception.WorkstreamNotFoundException;
import com.conflux.workspaceservice.workstream.repository.WorkstreamRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class WorkstreamService {

    private static final Logger LOGGER = LoggerFactory.getLogger(WorkstreamService.class);
    private static final Map<WorkstreamStatus, Set<WorkstreamStatus>> ALLOWED_TRANSITIONS = transitions();

    private final ProjectRepository projects;
    private final WorkstreamRepository workstreams;

    public WorkstreamService(ProjectRepository projects, WorkstreamRepository workstreams) {
        this.projects = projects;
        this.workstreams = workstreams;
    }

    @Transactional
    public WorkstreamDto create(UUID actorId, UUID projectId, CreateWorkstreamRequestDto request) {
        Project project = requireOwnedProject(projectId, actorId);
        Workstream workstream = new Workstream();
        workstream.setProject(project);
        workstream.setName(request.name());
        workstream.setBranchName(request.branchName());
        workstream.setBaseRevision(request.baseRevision().toLowerCase());
        workstream.setCurrentRevision(request.baseRevision().toLowerCase());
        workstream.setStatus(WorkstreamStatus.CREATED);
        workstream.setCreatedBy(actorId);
        try {
            workstreams.saveAndFlush(workstream);
        } catch (DataIntegrityViolationException failure) {
            if (hasConstraint(failure, "workstreams_project_branch_uq")) {
                throw new WorkstreamConflictException("This branch is already used by the project");
            }
            throw failure;
        }
        LOGGER.info("event=WORKSTREAM_CREATED project_id={} workstream_id={} actor_id={}",
                projectId, workstream.getWorkstreamId(), actorId);
        return toDto(workstream);
    }

    @Transactional(readOnly = true)
    public List<WorkstreamDto> list(UUID actorId, UUID projectId) {
        requireOwnedProject(projectId, actorId);
        return workstreams.findAllByProjectProjectIdAndProjectCreatedByOrderByCreatedAtDesc(
                        projectId, actorId).stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public WorkstreamDto get(UUID actorId, UUID projectId, UUID workstreamId) {
        return toDto(requireOwnedWorkstream(workstreamId, projectId, actorId));
    }

    @Transactional
    public WorkstreamDto update(
            UUID actorId, UUID projectId, UUID workstreamId, UpdateWorkstreamRequestDto request) {
        Workstream workstream = requireOwnedWorkstreamForUpdate(workstreamId, projectId, actorId);
        requireMutable(workstream);
        workstream.setName(request.name());
        workstreams.save(workstream);
        LOGGER.info("event=WORKSTREAM_UPDATED project_id={} workstream_id={} actor_id={}",
                projectId, workstreamId, actorId);
        return toDto(workstream);
    }

    @Transactional
    public WorkstreamDto updateStatus(
            UUID actorId, UUID projectId, UUID workstreamId, WorkstreamStatus requestedStatus) {
        Workstream workstream = requireOwnedWorkstreamForUpdate(workstreamId, projectId, actorId);
        WorkstreamStatus currentStatus = workstream.getStatus();
        if (currentStatus == requestedStatus) {
            return toDto(workstream);
        }
        if (!ALLOWED_TRANSITIONS.getOrDefault(currentStatus, Set.of()).contains(requestedStatus)) {
            throw new WorkstreamConflictException(
                    "Workstream cannot transition from " + currentStatus + " to " + requestedStatus);
        }
        workstream.setStatus(requestedStatus);
        workstreams.save(workstream);
        LOGGER.info("event=WORKSTREAM_STATUS_CHANGED project_id={} workstream_id={} actor_id={} old_status={} new_status={}",
                projectId, workstreamId, actorId, currentStatus, requestedStatus);
        return toDto(workstream);
    }

    private Project requireOwnedProject(UUID projectId, UUID actorId) {
        return projects.findByProjectIdAndCreatedBy(projectId, actorId)
                .orElseThrow(ProjectNotFoundException::new);
    }

    private Workstream requireOwnedWorkstream(UUID workstreamId, UUID projectId, UUID actorId) {
        return workstreams.findByWorkstreamIdAndProjectProjectIdAndProjectCreatedBy(
                        workstreamId, projectId, actorId)
                .orElseThrow(WorkstreamNotFoundException::new);
    }

    private Workstream requireOwnedWorkstreamForUpdate(
            UUID workstreamId, UUID projectId, UUID actorId) {
        return workstreams.findForUpdate(workstreamId, projectId, actorId)
                .orElseThrow(WorkstreamNotFoundException::new);
    }

    private void requireMutable(Workstream workstream) {
        if (workstream.getStatus() == WorkstreamStatus.MERGED) {
            throw new WorkstreamConflictException("Merged workstreams cannot be changed");
        }
    }

    private boolean hasConstraint(Throwable failure, String constraintName) {
        Throwable current = failure;
        while (current != null) {
            if (current.getMessage() != null && current.getMessage().contains(constraintName)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private WorkstreamDto toDto(Workstream workstream) {
        return new WorkstreamDto(workstream.getWorkstreamId(), workstream.getProject().getProjectId(),
                workstream.getName(), workstream.getBranchName(), workstream.getBaseRevision(),
                workstream.getCurrentRevision(), workstream.getStatus(), workstream.getCreatedBy(),
                workstream.getCreatedAt(), workstream.getUpdatedAt());
    }

    private static Map<WorkstreamStatus, Set<WorkstreamStatus>> transitions() {
        Map<WorkstreamStatus, Set<WorkstreamStatus>> transitions = new EnumMap<>(WorkstreamStatus.class);
        transitions.put(WorkstreamStatus.CREATED,
                EnumSet.of(WorkstreamStatus.ACTIVE, WorkstreamStatus.BLOCKED));
        transitions.put(WorkstreamStatus.ACTIVE,
                EnumSet.of(WorkstreamStatus.REVIEWING, WorkstreamStatus.BLOCKED));
        transitions.put(WorkstreamStatus.REVIEWING,
                EnumSet.of(WorkstreamStatus.ACTIVE, WorkstreamStatus.READY_TO_MERGE, WorkstreamStatus.BLOCKED));
        transitions.put(WorkstreamStatus.READY_TO_MERGE,
                EnumSet.of(WorkstreamStatus.REVIEWING, WorkstreamStatus.CONFLICT));
        transitions.put(WorkstreamStatus.BLOCKED,
                EnumSet.of(WorkstreamStatus.ACTIVE, WorkstreamStatus.REVIEWING));
        transitions.put(WorkstreamStatus.CONFLICT,
                EnumSet.of(WorkstreamStatus.ACTIVE, WorkstreamStatus.READY_TO_MERGE));
        transitions.put(WorkstreamStatus.MERGED, Set.of());
        return Map.copyOf(transitions);
    }
}
