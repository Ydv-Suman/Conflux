package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.identityservice.grpc.team.v1.TeamRole;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class TeamAuthorizationGrpcService extends TeamAuthorizationGrpc.TeamAuthorizationImplBase {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamAuthorizationGrpcService.class);

    private final TeamMembershipLookupService memberships;

    public TeamAuthorizationGrpcService(TeamMembershipLookupService memberships) {
        this.memberships = memberships;
    }

    @Override
    public void getMembership(
            GetTeamMembershipRequest request,
            StreamObserver<TeamMembershipResponse> responseObserver) {
        UUID userId;
        UUID teamId;
        try {
            userId = UUID.fromString(request.getUserId());
            teamId = UUID.fromString(request.getTeamId());
        } catch (IllegalArgumentException failure) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("user_id and team_id must be UUIDs")
                    .asRuntimeException());
            return;
        }

        TeamMembershipResponse response;
        try {
            response = memberships.find(userId, teamId)
                    .map(membership -> TeamMembershipResponse.newBuilder()
                            .setIsMember(true)
                            .setRole(toGrpcRole(membership.role()))
                            .addAllCapabilities(membership.capabilities().stream()
                                    .map(this::toGrpcCapability)
                                    .toList())
                            .build())
                    .orElseGet(() -> TeamMembershipResponse.newBuilder()
                            .setIsMember(false)
                            .build());
        } catch (RuntimeException failure) {
            LOGGER.error("event=GRPC_TEAM_MEMBERSHIP_LOOKUP_FAILED user_id={} team_id={} error_type={}",
                    userId, teamId, failure.getClass().getSimpleName());
            responseObserver.onError(Status.INTERNAL
                    .withDescription("Authorization lookup failed")
                    .asRuntimeException());
            return;
        }
        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }

    private TeamRole toGrpcRole(com.conflux.identityservice.team.entity.UserRole role) {
        return switch (role) {
            case ADMIN -> TeamRole.TEAM_ROLE_ADMIN;
            case TEAM_LEAD -> TeamRole.TEAM_ROLE_TEAM_LEAD;
            case SENIOR_DEVELOPER -> TeamRole.TEAM_ROLE_SENIOR_DEVELOPER;
            case DEVELOPER -> TeamRole.TEAM_ROLE_DEVELOPER;
            case VIEWER -> TeamRole.TEAM_ROLE_VIEWER;
        };
    }

    private TeamCapability toGrpcCapability(
            com.conflux.identityservice.team.entity.Capability capability) {
        return switch (capability) {
            case VIEW_PROJECT -> TeamCapability.TEAM_CAPABILITY_VIEW_PROJECT;
            case CREATE_PROJECT -> TeamCapability.TEAM_CAPABILITY_CREATE_PROJECT;
            case CREATE_WORKSTREAM -> TeamCapability.TEAM_CAPABILITY_CREATE_WORKSTREAM;
            case JOIN_WORKSTREAM -> TeamCapability.TEAM_CAPABILITY_JOIN_WORKSTREAM;
            case EDIT_DOCUMENT -> TeamCapability.TEAM_CAPABILITY_EDIT_DOCUMENT;
            case APPROVE_CHANGE -> TeamCapability.TEAM_CAPABILITY_APPROVE_CHANGE;
            case MANAGE_TEAM -> TeamCapability.TEAM_CAPABILITY_MANAGE_TEAM;
            case MANAGE_MEMBERS -> TeamCapability.TEAM_CAPABILITY_MANAGE_MEMBERS;
            case MANAGE_ROLES -> TeamCapability.TEAM_CAPABILITY_MANAGE_ROLES;
        };
    }
}
