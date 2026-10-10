package com.conflux.workspaceservice.identity.client;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesRequest;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsRequest;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.workspaceservice.identity.exception.IdentityServiceUnavailableException;
import com.conflux.workspaceservice.identity.model.TeamAuthorization;
import com.conflux.workspaceservice.identity.model.TeamMembership;
import com.conflux.workspaceservice.identity.model.TeamSummary;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Component
public class GrpcTeamAuthorizationClient implements TeamAuthorizationClient {

    private final TeamAuthorizationGrpc.TeamAuthorizationBlockingStub stub;
    private final Duration deadline;

    public GrpcTeamAuthorizationClient(
            TeamAuthorizationGrpc.TeamAuthorizationBlockingStub stub,
            @Value("${app.identity.grpc-deadline}") Duration deadline) {
        if (deadline.isZero() || deadline.isNegative()) {
            throw new IllegalArgumentException("Identity gRPC deadline must be positive");
        }
        this.stub = stub;
        this.deadline = deadline;
    }

    @Override
    public TeamAuthorization getAuthorization(UUID userId, UUID teamId) {
        try {
            TeamMembershipResponse response = stub
                    .withDeadlineAfter(deadline.toMillis(), TimeUnit.MILLISECONDS)
                    .getMembership(GetTeamMembershipRequest.newBuilder()
                            .setUserId(userId.toString())
                            .setTeamId(teamId.toString())
                            .build());
            EnumSet<com.conflux.workspaceservice.identity.model.TeamCapability> capabilities =
                    toCapabilities(response.getCapabilitiesList());
            return new TeamAuthorization(response.getIsMember(), capabilities);
        } catch (StatusRuntimeException failure) {
            Status.Code code = failure.getStatus().getCode();
            if (code == Status.Code.UNAVAILABLE
                    || code == Status.Code.DEADLINE_EXCEEDED
                    || code == Status.Code.UNAUTHENTICATED) {
                throw new IdentityServiceUnavailableException();
            }
            throw new IdentityServiceUnavailableException();
        }
    }

    @Override
    public List<TeamMembership> listMemberships(UUID userId) {
        try {
            return stub.withDeadlineAfter(deadline.toMillis(), TimeUnit.MILLISECONDS)
                    .listMemberships(ListTeamMembershipsRequest.newBuilder()
                            .setUserId(userId.toString())
                            .build())
                    .getMembershipsList().stream()
                    .map(membership -> new TeamMembership(
                            UUID.fromString(membership.getTeamId()),
                            toCapabilities(membership.getCapabilitiesList())))
                    .toList();
        } catch (StatusRuntimeException | IllegalArgumentException failure) {
            throw new IdentityServiceUnavailableException();
        }
    }

    @Override
    public List<TeamSummary> getTeamSummaries(Collection<UUID> teamIds) {
        if (teamIds.isEmpty()) {
            return List.of();
        }
        List<UUID> uniqueTeamIds = teamIds.stream().distinct().toList();
        List<TeamSummary> summaries = new ArrayList<>();
        try {
            for (int start = 0; start < uniqueTeamIds.size(); start += 100) {
                GetTeamSummariesRequest.Builder request = GetTeamSummariesRequest.newBuilder();
                uniqueTeamIds.subList(start, Math.min(start + 100, uniqueTeamIds.size()))
                        .forEach(teamId -> request.addTeamIds(teamId.toString()));
                stub.withDeadlineAfter(deadline.toMillis(), TimeUnit.MILLISECONDS)
                        .getTeamSummaries(request.build())
                        .getTeamsList()
                        .forEach(team -> summaries.add(new TeamSummary(
                                UUID.fromString(team.getTeamId()),
                                team.getName(),
                                team.getDescription())));
            }
            return List.copyOf(summaries);
        } catch (StatusRuntimeException | IllegalArgumentException failure) {
            throw new IdentityServiceUnavailableException();
        }
    }

    private EnumSet<com.conflux.workspaceservice.identity.model.TeamCapability> toCapabilities(
            List<TeamCapability> grpcCapabilities) {
        EnumSet<com.conflux.workspaceservice.identity.model.TeamCapability> capabilities =
                EnumSet.noneOf(com.conflux.workspaceservice.identity.model.TeamCapability.class);
        grpcCapabilities.forEach(capability -> {
            String name = capability.name().replace("TEAM_CAPABILITY_", "");
            if (!"UNSPECIFIED".equals(name) && !"UNRECOGNIZED".equals(name)) {
                try {
                    capabilities.add(com.conflux.workspaceservice.identity.model.TeamCapability
                            .valueOf(name));
                } catch (IllegalArgumentException ignored) {
                    // Unknown capabilities remain denied until Workspace explicitly supports them.
                }
            }
        });
        return capabilities;
    }
}
