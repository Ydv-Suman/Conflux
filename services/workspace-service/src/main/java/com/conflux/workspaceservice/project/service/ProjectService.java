package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.ProjectDto;
import com.conflux.workspaceservice.project.dto.ProjectTeamDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.entity.ProjectTeam;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.project.exception.ProjectConflictException;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
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
    private final ProjectTeamRepository projectTeams;
    private final ProjectAuthorizationService authorization;

    public ProjectService(
            ProjectRepository projects,
            ProjectTeamRepository projectTeams,
            ProjectAuthorizationService authorization) {
        this.projects = projects;
        this.projectTeams = projectTeams;
        this.authorization = authorization;
    }

    @Transactional
    public ProjectDto create(UUID actorId, CreateProjectRequestDto request) {
        authorization.requireTeamCapability(actorId, request.teamId(), TeamCapability.CREATE_PROJECT);
        Project project = new Project();
        project.setName(request.name());
        project.setDescription(request.description());
        project.setCreatedBy(actorId);
        try {
            projects.saveAndFlush(project);
            ProjectTeam assignment = new ProjectTeam();
            assignment.setProject(project);
            assignment.setTeamId(request.teamId());
            assignment.setAddedBy(actorId);
            projectTeams.saveAndFlush(assignment);
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
    public List<ProjectDto> list(UUID actorId, UUID teamId) {
        authorization.requireTeamCapability(actorId, teamId, TeamCapability.VIEW_PROJECT);
        return projects.findAllByTeamId(teamId).stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public ProjectDto get(UUID actorId, UUID projectId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.VIEW_PROJECT);
        return toDto(requireProject(projectId));
    }

    @Transactional
    public ProjectDto update(UUID actorId, UUID projectId, UpdateProjectRequestDto request) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.CREATE_PROJECT);
        Project project = requireProject(projectId);
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

    @Transactional(readOnly = true)
    public List<ProjectTeamDto> listTeams(UUID actorId, UUID projectId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.VIEW_PROJECT);
        return projectTeams.findAllByProjectProjectIdOrderByAddedAt(projectId).stream()
                .map(assignment -> new ProjectTeamDto(
                        assignment.getTeamId(), assignment.getAddedBy(), assignment.getAddedAt()))
                .toList();
    }

    @Transactional
    public ProjectTeamDto assignTeam(UUID actorId, UUID projectId, UUID teamId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.CREATE_PROJECT);
        authorization.requireTeamCapability(actorId, teamId, TeamCapability.CREATE_PROJECT);
        Project project = requireProject(projectId);
        ProjectTeam assignment = new ProjectTeam();
        assignment.setProject(project);
        assignment.setTeamId(teamId);
        assignment.setAddedBy(actorId);
        try {
            projectTeams.saveAndFlush(assignment);
        } catch (DataIntegrityViolationException failure) {
            if (hasConstraint(failure, "project_teams_project_team_uq")) {
                throw new ProjectConflictException("This team is already assigned to the project");
            }
            throw failure;
        }
        LOGGER.info("event=PROJECT_TEAM_ASSIGNED project_id={} team_id={} actor_id={}",
                projectId, teamId, actorId);
        return new ProjectTeamDto(teamId, actorId, assignment.getAddedAt());
    }

    @Transactional
    public void removeTeam(UUID actorId, UUID projectId, UUID teamId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.CREATE_PROJECT);
        projects.findForUpdate(projectId).orElseThrow(ProjectNotFoundException::new);
        if (!projectTeams.existsByProjectProjectIdAndTeamId(projectId, teamId)) {
            throw new ProjectNotFoundException();
        }
        if (projectTeams.countByProjectProjectId(projectId) <= 1) {
            throw new ProjectConflictException("A project must remain assigned to at least one team");
        }
        projectTeams.deleteByProjectProjectIdAndTeamId(projectId, teamId);
        LOGGER.info("event=PROJECT_TEAM_REMOVED project_id={} team_id={} actor_id={}",
                projectId, teamId, actorId);
    }

    private Project requireProject(UUID projectId) {
        return projects.findByProjectId(projectId)
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
