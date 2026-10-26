package com.conflux.identityservice.team.controller;

import com.conflux.identityservice.team.dto.AddTeamMemberRequestDto;
import com.conflux.identityservice.team.dto.TeamInvitationDto;
import com.conflux.identityservice.team.service.TeamInvitationService;
import com.conflux.identityservice.shared.service.RateLimitService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
public class TeamInvitationController {
    private final TeamInvitationService invitations;
    private final RateLimitService rateLimits;

    public TeamInvitationController(TeamInvitationService invitations, RateLimitService rateLimits) {
        this.invitations = invitations;
        this.rateLimits = rateLimits;
    }

    @PostMapping(path = "/api/teams/{teamId}/invitations", version = "1.0")
    public ResponseEntity<TeamInvitationDto> invite(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId,
            @Valid @RequestBody AddTeamMemberRequestDto request) {
        UUID actorId = actor(jwt);
        rateLimits.checkTeamMutation(actorId);
        return ResponseEntity.status(201).body(invitations.invite(actorId, teamId, request));
    }

    @GetMapping(path = "/api/users/me/invitations", version = "1.0")
    public List<TeamInvitationDto> inbox(@AuthenticationPrincipal Jwt jwt) {
        return invitations.inbox(actor(jwt));
    }

    @GetMapping(path = "/api/teams/{teamId}/invitations", version = "1.0")
    public List<TeamInvitationDto> list(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId) {
        return invitations.list(actor(jwt), teamId);
    }

    @PostMapping(path = "/api/invitations/{invitationId}/accept", version = "1.0")
    public TeamInvitationDto accept(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID invitationId) {
        UUID actorId = actor(jwt);
        rateLimits.checkTeamMutation(actorId);
        return invitations.respond(actorId, invitationId, true);
    }

    @PostMapping(path = "/api/invitations/{invitationId}/decline", version = "1.0")
    public TeamInvitationDto decline(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID invitationId) {
        UUID actorId = actor(jwt);
        rateLimits.checkTeamMutation(actorId);
        return invitations.respond(actorId, invitationId, false);
    }

    @DeleteMapping(path = "/api/teams/{teamId}/invitations/{invitationId}", version = "1.0")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID teamId,
            @PathVariable UUID invitationId) {
        UUID actorId = actor(jwt);
        rateLimits.checkTeamMutation(actorId);
        invitations.cancel(actorId, teamId, invitationId);
        return ResponseEntity.noContent().build();
    }

    private UUID actor(Jwt jwt) { return UUID.fromString(jwt.getSubject()); }
}
