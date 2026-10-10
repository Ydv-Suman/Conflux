package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.exception.TeamAccessDeniedException;
import com.conflux.identityservice.team.exception.TeamNotFoundException;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

class TeamAuthorizationServiceTests {

    private final TeamAuthorizationService authorization =
            new TeamAuthorizationService(mock(TeamMemberRepository.class));

    @Test
    void existingRolesMapToCentralCapabilities() {
        assertTrue(authorization.capabilities(UserRole.ADMIN).containsAll(
                java.util.EnumSet.allOf(Capability.class)));
        assertTrue(authorization.capabilities(UserRole.DEVELOPER).contains(Capability.EDIT_DOCUMENT));
        assertFalse(authorization.capabilities(UserRole.VIEWER).contains(Capability.EDIT_DOCUMENT));
        assertTrue(authorization.capabilities(UserRole.ADMIN).contains(Capability.MANAGE_TEAM));
        assertTrue(authorization.capabilities(UserRole.TEAM_LEAD).contains(Capability.MANAGE_TEAM));
        assertTrue(authorization.capabilities(UserRole.TEAM_LEAD).contains(Capability.MANAGE_MEMBERS));
        assertTrue(authorization.capabilities(UserRole.TEAM_LEAD).contains(Capability.MANAGE_ROLES));
        assertTrue(authorization.capabilities(UserRole.ADMIN).contains(Capability.MANAGE_PROJECT));
        assertTrue(authorization.capabilities(UserRole.TEAM_LEAD).contains(Capability.MANAGE_PROJECT));
        assertFalse(authorization.capabilities(UserRole.SENIOR_DEVELOPER)
                .contains(Capability.MANAGE_PROJECT));
    }

    @Test
    void teamLeadCannotAssignAdminOrPeerRole() {
        assertThrows(TeamAccessDeniedException.class,
                () -> authorization.requireCanManageRole(
                        UserRole.TEAM_LEAD, UserRole.DEVELOPER, UserRole.ADMIN));
        assertThrows(TeamAccessDeniedException.class,
                () -> authorization.requireCanManageRole(
                        UserRole.TEAM_LEAD, UserRole.DEVELOPER, UserRole.TEAM_LEAD));
    }

    @Test
    void teamLeadCanManageLowerRoles() {
        authorization.requireCanManageRole(
                UserRole.TEAM_LEAD, UserRole.DEVELOPER, UserRole.SENIOR_DEVELOPER);
    }

    @Test
    void nonMemberGetsNotFoundWithoutTeamDisclosure() {
        TeamMemberRepository members = mock(TeamMemberRepository.class);
        UUID teamId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(members.findByTeamTeamIdAndUserUserId(teamId, userId)).thenReturn(Optional.empty());

        TeamAuthorizationService service = new TeamAuthorizationService(members);

        assertThrows(TeamNotFoundException.class, () -> service.requireMember(teamId, userId));
    }
}
