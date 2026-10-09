package com.conflux.identityservice.team.controller;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.dto.CreateTeamRequestDto;
import com.conflux.identityservice.team.dto.TeamCapabilitiesDto;
import com.conflux.identityservice.team.dto.TeamDto;
import com.conflux.identityservice.team.dto.TeamMemberDto;
import com.conflux.identityservice.team.dto.UpdateTeamMemberRoleRequestDto;
import com.conflux.identityservice.team.dto.UpdateTeamRequestDto;
import com.conflux.identityservice.shared.service.RateLimitService;
import com.conflux.identityservice.team.service.TeamService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/teams")
public class TeamController {

    private final TeamService teams;
    private final RateLimitService rateLimits;

    public TeamController(TeamService teams, RateLimitService rateLimits) {
        this.teams = teams;
        this.rateLimits = rateLimits;
    }

    @PostMapping(version = "1.0")
    public ResponseEntity<TeamDto> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateTeamRequestDto request) {
        UUID actorId = userId(jwt);
        rateLimits.checkTeamMutation(actorId);
        return ResponseEntity.status(HttpStatus.CREATED).body(teams.create(actorId, request));
    }

    @GetMapping(version = "1.0")
    public List<TeamDto> list(@AuthenticationPrincipal Jwt jwt) {
        return teams.list(userId(jwt));
    }

    @GetMapping(path = "/{teamId}", version = "1.0")
    public TeamDto get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId) {
        return teams.get(userId(jwt), teamId);
    }

    @PutMapping(path = "/{teamId}", version = "1.0")
    public TeamDto update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID teamId,
            @Valid @RequestBody UpdateTeamRequestDto request) {
        UUID actorId = userId(jwt);
        rateLimits.checkTeamMutation(actorId);
        return teams.update(actorId, teamId, request);
    }

    @GetMapping(path = "/{teamId}/members", version = "1.0")
    public List<TeamMemberDto> listMembers(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId) {
        return teams.listMembers(userId(jwt), teamId);
    }

    @PostMapping(path = "/{teamId}/members", version = "1.0")
    public ResponseEntity<TeamMemberDto> addMember(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID teamId,
            @Valid @RequestBody AddTeamMemberRequestDto request) {
        UUID actorId = userId(jwt);
        rateLimits.checkTeamMutation(actorId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(teams.addMember(actorId, teamId, request));
    }

    @PutMapping(path = "/{teamId}/members/{memberId}/role", version = "1.0")
    public TeamMemberDto updateRole(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID teamId,
            @PathVariable UUID memberId,
            @Valid @RequestBody UpdateTeamMemberRoleRequestDto request) {
        UUID actorId = userId(jwt);
        rateLimits.checkTeamMutation(actorId);
        return teams.updateRole(actorId, teamId, memberId, request.role());
    }

    @DeleteMapping(path = "/{teamId}/members/{memberId}", version = "1.0")
    public ResponseEntity<Void> removeMember(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID teamId,
            @PathVariable UUID memberId) {
        UUID actorId = userId(jwt);
        rateLimits.checkTeamMutation(actorId);
        teams.removeMember(actorId, teamId, memberId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping(path = "/{teamId}/capabilities/me", version = "1.0")
    public TeamCapabilitiesDto capabilities(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId) {
        return teams.capabilities(userId(jwt), teamId);
    }

    private UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
