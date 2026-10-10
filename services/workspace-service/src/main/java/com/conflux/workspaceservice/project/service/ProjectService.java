package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.ProjectDto;
import com.conflux.workspaceservice.project.dto.ProjectTeamDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.project.entity.Project;
import com.conflux.workspaceservice.project.entity.ProjectTeam;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.identity.model.TeamSummary;
import com.conflux.workspaceservice.project.exception.ProjectConflictException;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import com.conflux.workspaceservice.workstream.repository.WorkstreamRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ProjectService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ProjectService.class);

    private final ProjectRepository projects;
    private final ProjectTeamRepository projectTeams;
    private final ProjectAuthorizationService authorization;
    private final TeamAuthorizationClient identity;
    private final WorkstreamRepository workstreams;

    public ProjectService(
            ProjectRepository projects,
            ProjectTeamRepository projectTeams,
            ProjectAuthorizationService authorization,
            TeamAuthorizationClient identity,
            WorkstreamRepository workstreams) {
        this.projects = projects;
        this.projectTeams = projectTeams;
        this.authorization = authorization;
        this.identity = identity;
        this.workstreams = workstreams;
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
        List<UUID> teamIds = authorization.teamIdsWithCapability(actorId, TeamCapability.VIEW_PROJECT);
        Map<UUID, Project> accessible = new LinkedHashMap<>();
        projects.findAllByCreatedByOrderByCreatedAtDesc(actorId)
                .forEach(project -> accessible.put(project.getProjectId(), project));
        if (!teamIds.isEmpty()) {
            projects.findAllByTeamIds(teamIds)
                    .forEach(project -> accessible.putIfAbsent(project.getProjectId(), project));
        }
        return accessible.values().stream()
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
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.MANAGE_PROJECT);
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
        List<ProjectTeam> assignments = projectTeams.findAllByProjectProjectIdOrderByAddedAt(projectId);
        if (assignments.isEmpty()) {
            return List.of();
        }
        Map<UUID, TeamSummary> summaries = identity.getTeamSummaries(assignments.stream()
                        .map(ProjectTeam::getTeamId)
                        .toList()).stream()
                .collect(Collectors.toMap(TeamSummary::teamId, Function.identity()));
        return assignments.stream()
                .map(assignment -> toDto(assignment, summaries.get(assignment.getTeamId())))
                .toList();
    }

    @Transactional
    public ProjectTeamDto assignTeam(UUID actorId, UUID projectId, UUID teamId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.MANAGE_PROJECT);
        authorization.requireTeamCapability(actorId, teamId, TeamCapability.MANAGE_PROJECT);
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
        TeamSummary summary = identity.getTeamSummaries(List.of(teamId)).stream()
                .findFirst()
                .orElse(null);
        return toDto(assignment, summary);
    }

    @Transactional
    public void removeTeam(UUID actorId, UUID projectId, UUID teamId) {
        authorization.requireProjectCapability(actorId, projectId, TeamCapability.MANAGE_PROJECT);
        projects.findForUpdate(projectId).orElseThrow(ProjectNotFoundException::new);
        if (!projectTeams.existsByProjectProjectIdAndTeamId(projectId, teamId)) {
            throw new ProjectNotFoundException();
        }
        if (workstreams.existsByProjectProjectIdAndTeamId(projectId, teamId)) {
            throw new ProjectConflictException("A team with workstreams cannot be removed");
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

    private ProjectTeamDto toDto(ProjectTeam assignment, TeamSummary summary) {
        return new ProjectTeamDto(
                assignment.getTeamId(),
                summary == null ? "" : summary.name(),
                summary == null ? "" : summary.description(),
                assignment.getAddedBy(),
                assignment.getAddedAt());
    }
}
