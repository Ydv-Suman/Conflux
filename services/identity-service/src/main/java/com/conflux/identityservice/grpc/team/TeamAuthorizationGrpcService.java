package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesResponse;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsRequest;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsResponse;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembership;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.identityservice.grpc.team.v1.TeamRole;
import com.conflux.identityservice.grpc.team.v1.TeamSummary;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class TeamAuthorizationGrpcService extends TeamAuthorizationGrpc.TeamAuthorizationImplBase {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamAuthorizationGrpcService.class);
    private static final int MAX_TEAM_SUMMARIES_PER_REQUEST = 100;

    private final TeamMembershipLookupService memberships;
    private final TeamSummaryLookupService teamSummaries;

    public TeamAuthorizationGrpcService(
            TeamMembershipLookupService memberships,
            TeamSummaryLookupService teamSummaries) {
        this.memberships = memberships;
        this.teamSummaries = teamSummaries;
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

    @Override
    public void listMemberships(
            ListTeamMembershipsRequest request,
            StreamObserver<ListTeamMembershipsResponse> responseObserver) {
        UUID userId;
        try {
            userId = UUID.fromString(request.getUserId());
        } catch (IllegalArgumentException failure) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("user_id must be a UUID")
                    .asRuntimeException());
            return;
        }

        try {
            ListTeamMembershipsResponse response = ListTeamMembershipsResponse.newBuilder()
                    .addAllMemberships(memberships.findAll(userId).stream()
                            .map(membership -> TeamMembership.newBuilder()
                                    .setTeamId(membership.teamId().toString())
                                    .setRole(toGrpcRole(membership.role()))
                                    .addAllCapabilities(membership.capabilities().stream()
                                            .map(this::toGrpcCapability)
                                            .toList())
                                    .build())
                            .toList())
                    .build();
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (RuntimeException failure) {
            LOGGER.error("event=GRPC_TEAM_MEMBERSHIPS_LOOKUP_FAILED user_id={} error_type={}",
                    userId, failure.getClass().getSimpleName());
            responseObserver.onError(Status.INTERNAL
                    .withDescription("Authorization lookup failed")
                    .asRuntimeException());
        }
    }

    @Override
    public void getTeamSummaries(
            GetTeamSummariesRequest request,
            StreamObserver<GetTeamSummariesResponse> responseObserver) {
        if (request.getTeamIdsCount() > MAX_TEAM_SUMMARIES_PER_REQUEST) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("At most 100 team_ids are allowed")
                    .asRuntimeException());
            return;
        }

        List<UUID> teamIds;
        try {
            teamIds = request.getTeamIdsList().stream().map(UUID::fromString).distinct().toList();
        } catch (IllegalArgumentException failure) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("team_ids must be UUIDs")
                    .asRuntimeException());
            return;
        }

        try {
            GetTeamSummariesResponse response = GetTeamSummariesResponse.newBuilder()
                    .addAllTeams(teamSummaries.findAll(teamIds).stream()
                            .map(team -> TeamSummary.newBuilder()
                                    .setTeamId(team.teamId().toString())
                                    .setName(team.name())
                                    .setDescription(team.description() == null ? "" : team.description())
                                    .build())
                            .toList())
                    .build();
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (RuntimeException failure) {
            LOGGER.error("event=GRPC_TEAM_SUMMARIES_LOOKUP_FAILED team_count={} error_type={}",
                    teamIds.size(), failure.getClass().getSimpleName());
            responseObserver.onError(Status.INTERNAL
                    .withDescription("Team summary lookup failed")
                    .asRuntimeException());
        }
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
            case MANAGE_PROJECT -> TeamCapability.TEAM_CAPABILITY_MANAGE_PROJECT;
        };
    }
}
