package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.identity.model.TeamMembership;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectRepository;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class ProjectAuthorizationService {

    private final ProjectTeamRepository projectTeams;
    private final ProjectRepository projects;
    private final TeamAuthorizationClient identity;

    public ProjectAuthorizationService(
            ProjectTeamRepository projectTeams,
            ProjectRepository projects,
            TeamAuthorizationClient identity) {
        this.projectTeams = projectTeams;
        this.projects = projects;
        this.identity = identity;
    }

    public void requireTeamCapability(UUID actorId, UUID teamId, TeamCapability capability) {
        if (!identity.getAuthorization(actorId, teamId).has(capability)) {
            throw new ProjectNotFoundException();
        }
    }

    public void requireProjectCapability(UUID actorId, UUID projectId, TeamCapability capability) {
        if (projects.existsByProjectIdAndCreatedBy(projectId, actorId)) {
            return;
        }
        boolean allowed = projectTeams.findTeamIdsByProjectId(projectId).stream()
                .anyMatch(teamId -> identity.getAuthorization(actorId, teamId).has(capability));
        if (!allowed) {
            throw new ProjectNotFoundException();
        }
    }

    public void requireProjectTeamCapability(
            UUID actorId, UUID projectId, UUID teamId, TeamCapability capability) {
        if (!projectTeams.existsByProjectProjectIdAndTeamId(projectId, teamId)
                || !identity.getAuthorization(actorId, teamId).has(capability)) {
            throw new ProjectNotFoundException();
        }
    }

    public List<UUID> teamIdsWithCapability(UUID actorId, TeamCapability capability) {
        return identity.listMemberships(actorId).stream()
                .filter(membership -> membership.has(capability))
                .map(TeamMembership::teamId)
                .toList();
    }
}
