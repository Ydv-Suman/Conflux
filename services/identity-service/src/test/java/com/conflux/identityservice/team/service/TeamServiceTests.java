package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.entity.Team;
import com.conflux.identityservice.team.entity.TeamMember;
import com.conflux.identityservice.team.dto.TeamMemberDto;
import com.conflux.identityservice.team.dto.UpdateTeamRequestDto;
import com.conflux.identityservice.team.exception.TeamAccessDeniedException;
import com.conflux.identityservice.team.exception.TeamNotFoundException;
import com.conflux.identityservice.user.entity.User;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.team.repository.TeamRepository;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import com.conflux.identityservice.user.repository.UserRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TeamServiceTests {

    private final TeamRepository teams = mock(TeamRepository.class);
    private final TeamMemberRepository members = mock(TeamMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final UserEmailRepository emails = mock(UserEmailRepository.class);
    private final TeamAuthorizationService authorization = mock(TeamAuthorizationService.class);
    private final TeamService service = new TeamService(teams, members, users, emails, authorization);

    @Test
    void cannotRemoveTheFinalAdmin() {
        UUID teamId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();
        Team team = new Team();
        team.setTeamId(teamId);
        User admin = new User();
        admin.setUserId(adminId);
        TeamMember membership = new TeamMember();
        membership.setTeam(team);
        membership.setUser(admin);
        membership.setRole(UserRole.ADMIN);

        when(members.findAllForUpdate(teamId)).thenReturn(List.of(membership));

        assertThrows(TeamMembershipConflictException.class,
                () -> service.removeMember(adminId, teamId, adminId));
    }

    @Test
    void revokedRoleCannotMutateAfterMembershipsAreLocked() {
        UUID teamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Team team = new Team();
        team.setTeamId(teamId);
        User actor = new User();
        actor.setUserId(actorId);
        TeamMember membership = new TeamMember();
        membership.setTeam(team);
        membership.setUser(actor);
        membership.setRole(UserRole.DEVELOPER);
        when(members.findAllForUpdate(teamId)).thenReturn(List.of(membership));

        TeamService secureService = new TeamService(
                teams, members, users, emails, new TeamAuthorizationService(members));

        assertThrows(TeamAccessDeniedException.class,
                () -> secureService.removeMember(actorId, teamId, actorId));
    }

    @Test
    void memberListingDoesNotExposeEmailAddresses() {
        assertFalse(java.util.Arrays.stream(TeamMemberDto.class.getRecordComponents())
                .anyMatch(component -> component.getName().equals("email")));
    }

    @Test
    void nonMemberCannotListMembers() {
        UUID teamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(members.findMembers(teamId, actorId)).thenReturn(List.of());

        assertThrows(TeamNotFoundException.class,
                () -> service.listMembers(actorId, teamId));
    }

    @Test
    void developerCannotUpdateTeamData() {
        UUID teamId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Team team = new Team();
        team.setTeamId(teamId);
        User actor = new User();
        actor.setUserId(actorId);
        TeamMember membership = new TeamMember();
        membership.setTeam(team);
        membership.setUser(actor);
        membership.setRole(UserRole.DEVELOPER);
        when(members.findAllForUpdate(teamId)).thenReturn(List.of(membership));

        TeamService secureService = new TeamService(
                teams, members, users, emails, new TeamAuthorizationService(members));

        assertThrows(TeamAccessDeniedException.class,
                () -> secureService.update(actorId, teamId, new UpdateTeamRequestDto("Renamed")));
        verify(teams, never()).save(team);
    }
}
