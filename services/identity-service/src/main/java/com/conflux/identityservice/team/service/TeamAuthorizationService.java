package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.TeamMember;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.exception.TeamAccessDeniedException;
import com.conflux.identityservice.team.exception.TeamNotFoundException;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import org.springframework.stereotype.Service;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class TeamAuthorizationService {

    private static final Map<UserRole, Set<Capability>> CAPABILITIES = capabilitiesByRole();

    private final TeamMemberRepository members;

    public TeamAuthorizationService(TeamMemberRepository members) {
        this.members = members;
    }

    public TeamMember requireMember(UUID teamId, UUID userId) {
        return members.findByTeamTeamIdAndUserUserId(teamId, userId)
                .orElseThrow(TeamNotFoundException::new);
    }

    public void requireCapability(TeamMember member, Capability capability) {
        if (!capabilities(member.getRole()).contains(capability)) {
            throw new TeamAccessDeniedException();
        }
    }

    public Set<Capability> capabilities(UserRole role) {
        return Set.copyOf(CAPABILITIES.get(role));
    }

    public void requireCanManageRole(UserRole actor, UserRole target, UserRole requested) {
        if (actor == UserRole.ADMIN) {
            return;
        }
        if (rank(actor) >= rank(target) || rank(actor) >= rank(requested)) {
            throw new TeamAccessDeniedException();
        }
    }

    private int rank(UserRole role) {
        return switch (role) {
            case ADMIN -> 0;
            case TEAM_LEAD -> 1;
            case SENIOR_DEVELOPER -> 2;
            case DEVELOPER -> 3;
            case VIEWER -> 4;
        };
    }

    private static Map<UserRole, Set<Capability>> capabilitiesByRole() {
        Map<UserRole, Set<Capability>> result = new EnumMap<>(UserRole.class);
        result.put(UserRole.ADMIN, EnumSet.allOf(Capability.class));
        result.put(UserRole.TEAM_LEAD, EnumSet.of(
                Capability.VIEW_PROJECT, Capability.CREATE_PROJECT,
                Capability.CREATE_WORKSTREAM, Capability.JOIN_WORKSTREAM,
                Capability.EDIT_DOCUMENT, Capability.APPROVE_CHANGE,
                Capability.MANAGE_MEMBERS, Capability.MANAGE_ROLES));
        result.put(UserRole.SENIOR_DEVELOPER, EnumSet.of(
                Capability.VIEW_PROJECT, Capability.CREATE_WORKSTREAM,
                Capability.JOIN_WORKSTREAM, Capability.EDIT_DOCUMENT,
                Capability.APPROVE_CHANGE));
        result.put(UserRole.DEVELOPER, EnumSet.of(
                Capability.VIEW_PROJECT, Capability.JOIN_WORKSTREAM,
                Capability.EDIT_DOCUMENT));
        result.put(UserRole.VIEWER, EnumSet.of(Capability.VIEW_PROJECT));
        return Map.copyOf(result);
    }
}
