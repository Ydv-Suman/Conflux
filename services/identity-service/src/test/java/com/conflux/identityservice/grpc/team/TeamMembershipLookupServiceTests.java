package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.Team;
import com.conflux.identityservice.team.entity.TeamMember;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.team.service.TeamAuthorizationService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TeamMembershipLookupServiceTests {

    private final TeamMemberRepository members = mock(TeamMemberRepository.class);
    private final TeamAuthorizationService authorization = mock(TeamAuthorizationService.class);
    private final TeamMembershipLookupService service =
            new TeamMembershipLookupService(members, authorization);

    @Test
    void returnsVerifiedMembershipCapabilities() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        TeamMember member = new TeamMember();
        member.setRole(UserRole.DEVELOPER);
        when(members.findByTeamTeamIdAndUserUserId(teamId, userId))
                .thenReturn(Optional.of(member));
        when(authorization.capabilities(UserRole.DEVELOPER))
                .thenReturn(Set.of(Capability.VIEW_PROJECT, Capability.EDIT_DOCUMENT));

        TeamMembershipLookupService.Membership result = service.find(userId, teamId).orElseThrow();

        assertEquals(UserRole.DEVELOPER, result.role());
        assertEquals(Set.of(Capability.VIEW_PROJECT, Capability.EDIT_DOCUMENT), result.capabilities());
    }

    @Test
    void returnsEmptyForNonMember() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(members.findByTeamTeamIdAndUserUserId(teamId, userId)).thenReturn(Optional.empty());

        assertTrue(service.find(userId, teamId).isEmpty());
    }

    @Test
    void listsEveryMembershipForUser() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        Team team = new Team();
        team.setTeamId(teamId);
        TeamMember member = new TeamMember();
        member.setTeam(team);
        member.setRole(UserRole.VIEWER);
        when(members.findAllByUserUserIdOrderByJoinedAt(userId)).thenReturn(List.of(member));
        when(authorization.capabilities(UserRole.VIEWER))
                .thenReturn(Set.of(Capability.VIEW_PROJECT));

        TeamMembershipLookupService.TeamMembership result = service.findAll(userId).getFirst();

        assertEquals(teamId, result.teamId());
        assertEquals(UserRole.VIEWER, result.role());
        assertEquals(Set.of(Capability.VIEW_PROJECT), result.capabilities());
    }
}
