package com.conflux.identityservice.team.service;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.dto.CreateTeamRequestDto;
import com.conflux.identityservice.team.dto.TeamCapabilitiesDto;
import com.conflux.identityservice.team.dto.TeamDto;
import com.conflux.identityservice.team.dto.TeamMemberDto;
import com.conflux.identityservice.team.dto.UpdateTeamRequestDto;
import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.Team;
import com.conflux.identityservice.team.entity.TeamMember;
import com.conflux.identityservice.user.entity.User;
import com.conflux.identityservice.user.entity.UserEmail;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import com.conflux.identityservice.team.exception.TeamNotFoundException;
import com.conflux.identityservice.user.exception.UserNotFoundException;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.team.repository.TeamRepository;
import com.conflux.identityservice.user.repository.UserEmailRepository;
import com.conflux.identityservice.user.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class TeamService {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamService.class);

    private final TeamRepository teams;
    private final TeamMemberRepository members;
    private final UserRepository users;
    private final UserEmailRepository emails;
    private final TeamAuthorizationService authorization;

    public TeamService(
            TeamRepository teams,
            TeamMemberRepository members,
            UserRepository users,
            UserEmailRepository emails,
            TeamAuthorizationService authorization) {
        this.teams = teams;
        this.members = members;
        this.users = users;
        this.emails = emails;
        this.authorization = authorization;
    }

    @Transactional
    public TeamDto create(UUID actorId, CreateTeamRequestDto request) {
        User actor = verifiedUser(actorId);
        Team team = new Team();
        team.setName(request.name());
        team.setCreatedBy(actor);
        teams.saveAndFlush(team);

        TeamMember membership = new TeamMember();
        membership.setTeam(team);
        membership.setUser(actor);
        membership.setRole(UserRole.ADMIN);
        members.save(membership);

        LOGGER.info("event=TEAM_CREATED team_id={} actor_id={}", team.getTeamId(), actorId);
        return toDto(team, UserRole.ADMIN);
    }

    @Transactional(readOnly = true)
    public List<TeamDto> list(UUID actorId) {
        return members.findAllByUserUserIdOrderByJoinedAt(actorId).stream()
                .map(member -> toDto(member.getTeam(), member.getRole()))
                .toList();
    }

    @Transactional(readOnly = true)
    public TeamDto get(UUID actorId, UUID teamId) {
        TeamMember member = authorization.requireMember(teamId, actorId);
        return toDto(member.getTeam(), member.getRole());
    }

    @Transactional
    public TeamDto update(UUID actorId, UUID teamId, UpdateTeamRequestDto request) {
        List<TeamMember> lockedMembers = members.findAllForUpdate(teamId);
        TeamMember actor = findMember(lockedMembers, actorId);
        authorization.requireCapability(actor, Capability.MANAGE_TEAM);

        Team team = teams.findById(teamId).orElseThrow(TeamNotFoundException::new);
        team.setName(request.name());
        teams.save(team);
        LOGGER.info("event=TEAM_UPDATED team_id={} actor_id={}", teamId, actorId);
        return toDto(team, actor.getRole());
    }

    @Transactional(readOnly = true)
    public List<TeamMemberDto> listMembers(UUID actorId, UUID teamId) {
        List<TeamMember> teamMembers = members.findMembers(teamId, actorId);
        if (teamMembers.isEmpty()) {
            throw new TeamNotFoundException();
        }
        return teamMembers.stream().map(this::toMemberDto).toList();
    }

    @Transactional
    public TeamMemberDto addMember(UUID actorId, UUID teamId, AddTeamMemberRequestDto request) {
        List<TeamMember> lockedMembers = members.findAllForUpdate(teamId);
        TeamMember actor = findMember(lockedMembers, actorId);
        authorization.requireCapability(actor, Capability.MANAGE_MEMBERS);
        authorization.requireCanManageRole(actor.getRole(), UserRole.VIEWER, request.role());

        UserEmail targetEmail = emails.findVerifiedByEmail(request.email())
                .orElseThrow(UserNotFoundException::new);
        User target = targetEmail.getUser();
        if (containsUser(lockedMembers, target.getUserId())) {
            throw new TeamMembershipConflictException("User is already a team member");
        }

        Team team = teams.findById(teamId).orElseThrow(TeamNotFoundException::new);
        TeamMember membership = new TeamMember();
        membership.setTeam(team);
        membership.setUser(target);
        membership.setRole(request.role());
        try {
            members.saveAndFlush(membership);
        } catch (DataIntegrityViolationException failure) {
            if (hasConstraint(failure, "team_members_team_user_uq")) {
                throw new TeamMembershipConflictException("User is already a team member");
            }
            throw failure;
        }

        LOGGER.info("event=TEAM_MEMBER_ADDED team_id={} actor_id={} target_id={} role={}",
                teamId, actorId, target.getUserId(), request.role());
        return toMemberDto(membership);
    }

    @Transactional
    public TeamMemberDto updateRole(
            UUID actorId, UUID teamId, UUID targetId, UserRole requestedRole) {
        List<TeamMember> lockedMembers = members.findAllForUpdate(teamId);
        TeamMember actor = findMember(lockedMembers, actorId);
        authorization.requireCapability(actor, Capability.MANAGE_ROLES);
        TeamMember target = findMember(lockedMembers, targetId);
        authorization.requireCanManageRole(actor.getRole(), target.getRole(), requestedRole);
        requireAdminRemains(lockedMembers, target, requestedRole);

        UserRole previousRole = target.getRole();
        target.setRole(requestedRole);
        members.save(target);
        LOGGER.info("event=TEAM_ROLE_CHANGED team_id={} actor_id={} target_id={} old_role={} new_role={}",
                teamId, actorId, targetId, previousRole, requestedRole);
        return toMemberDto(target);
    }

    @Transactional
    public void removeMember(UUID actorId, UUID teamId, UUID targetId) {
        List<TeamMember> lockedMembers = members.findAllForUpdate(teamId);
        TeamMember actor = findMember(lockedMembers, actorId);
        authorization.requireCapability(actor, Capability.MANAGE_MEMBERS);
        TeamMember target = findMember(lockedMembers, targetId);
        authorization.requireCanManageRole(actor.getRole(), target.getRole(), UserRole.VIEWER);
        requireAdminRemains(lockedMembers, target, null);

        members.delete(target);
        LOGGER.info("event=TEAM_MEMBER_REMOVED team_id={} actor_id={} target_id={} role={}",
                teamId, actorId, targetId, target.getRole());
    }

    @Transactional(readOnly = true)
    public TeamCapabilitiesDto capabilities(UUID actorId, UUID teamId) {
        TeamMember member = authorization.requireMember(teamId, actorId);
        return new TeamCapabilitiesDto(teamId, actorId, member.getRole(),
                authorization.capabilities(member.getRole()));
    }

    private User verifiedUser(UUID userId) {
        User user = users.findById(userId).orElseThrow(UserNotFoundException::new);
        if (user.getPrimaryEmail() == null || user.getPrimaryEmail().getVerifiedAt() == null) {
            throw new TeamMembershipConflictException("Verified email is required");
        }
        return user;
    }

    private TeamMember findMember(List<TeamMember> teamMembers, UUID userId) {
        return teamMembers.stream()
                .filter(member -> member.getUser().getUserId().equals(userId))
                .findFirst()
                .orElseThrow(TeamNotFoundException::new);
    }

    private boolean containsUser(List<TeamMember> teamMembers, UUID userId) {
        return teamMembers.stream()
                .anyMatch(member -> member.getUser().getUserId().equals(userId));
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

    private void requireAdminRemains(
            List<TeamMember> teamMembers, TeamMember target, UserRole requestedRole) {
        if (target.getRole() == UserRole.ADMIN
                && requestedRole != UserRole.ADMIN
                && teamMembers.stream().filter(member -> member.getRole() == UserRole.ADMIN).count() == 1) {
            throw new TeamMembershipConflictException("A team must retain at least one admin");
        }
    }

    private TeamDto toDto(Team team, UserRole role) {
        return new TeamDto(team.getTeamId(), team.getName(), role, team.getCreatedAt());
    }

    private TeamMemberDto toMemberDto(TeamMember member) {
        User user = member.getUser();
        return new TeamMemberDto(user.getUserId(), fullName(user), user.getUsername(),
                member.getRole(), member.getJoinedAt());
    }

    private String fullName(User user) {
        return java.util.stream.Stream.of(user.getFirstName(), user.getMiddleName(), user.getLastName())
                .filter(part -> part != null && !part.isBlank())
                .collect(java.util.stream.Collectors.joining(" "));
    }
}
