package com.conflux.workspaceservice.project.service;

import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.repository.ProjectTeamRepository;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class ProjectAuthorizationService {

    private final ProjectTeamRepository projectTeams;
    private final TeamAuthorizationClient identity;

    public ProjectAuthorizationService(
            ProjectTeamRepository projectTeams, TeamAuthorizationClient identity) {
        this.projectTeams = projectTeams;
        this.identity = identity;
    }

    public void requireTeamCapability(UUID actorId, UUID teamId, TeamCapability capability) {
        if (!identity.getAuthorization(actorId, teamId).has(capability)) {
            throw new ProjectNotFoundException();
        }
    }

    public void requireProjectCapability(UUID actorId, UUID projectId, TeamCapability capability) {
        boolean allowed = projectTeams.findTeamIdsByProjectId(projectId).stream()
                .anyMatch(teamId -> identity.getAuthorization(actorId, teamId).has(capability));
        if (!allowed) {
            throw new ProjectNotFoundException();
        }
    }
}
