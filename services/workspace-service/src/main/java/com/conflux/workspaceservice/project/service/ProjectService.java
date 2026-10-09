package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.ProjectDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.exception.ProjectConflictException;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ProjectService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ProjectService.class);

    private final ProjectRepository projects;

    public ProjectService(ProjectRepository projects) {
        this.projects = projects;
    }

    @Transactional
    public ProjectDto create(UUID actorId, CreateProjectRequestDto request) {
        Project project = new Project();
        project.setName(request.name());
        project.setDescription(request.description());
        project.setCreatedBy(actorId);
        try {
            projects.saveAndFlush(project);
        } catch (DataIntegrityViolationException failure) {
            if (hasConstraint(failure, "projects_creator_name_uq")) {
                throw new ProjectConflictException("A project with this name already exists");
            }
            throw failure;
        }
        LOGGER.info("event=PROJECT_CREATED project_id={} actor_id={}", project.getProjectId(), actorId);
        return toDto(project);
    }

    @Transactional(readOnly = true)
    public List<ProjectDto> list(UUID actorId) {
        return projects.findAllByCreatedByOrderByCreatedAtDesc(actorId).stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public ProjectDto get(UUID actorId, UUID projectId) {
        return toDto(requireOwnedProject(projectId, actorId));
    }

    @Transactional
    public ProjectDto update(UUID actorId, UUID projectId, UpdateProjectRequestDto request) {
        Project project = requireOwnedProject(projectId, actorId);
        project.setName(request.name());
        project.setDescription(request.description());
        try {
            projects.saveAndFlush(project);
        } catch (DataIntegrityViolationException failure) {
            if (hasConstraint(failure, "projects_creator_name_uq")) {
                throw new ProjectConflictException("A project with this name already exists");
            }
            throw failure;
        }
        LOGGER.info("event=PROJECT_UPDATED project_id={} actor_id={}", projectId, actorId);
        return toDto(project);
    }

    private Project requireOwnedProject(UUID projectId, UUID actorId) {
        return projects.findByProjectIdAndCreatedBy(projectId, actorId)
                .orElseThrow(ProjectNotFoundException::new);
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

    private ProjectDto toDto(Project project) {
        return new ProjectDto(project.getProjectId(), project.getName(), project.getDescription(),
                project.getCreatedBy(), project.getCreatedAt(), project.getUpdatedAt());
    }
}
