package com.conflux.workspaceservice.identity.client;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.workspaceservice.identity.exception.IdentityServiceUnavailableException;
import com.conflux.workspaceservice.identity.model.TeamAuthorization;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.EnumSet;
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
            EnumSet<TeamCapability> capabilities = EnumSet.noneOf(TeamCapability.class);
            response.getCapabilitiesList().forEach(capability -> {
                String name = capability.name().replace("TEAM_CAPABILITY_", "");
                if (!"UNSPECIFIED".equals(name) && !"UNRECOGNIZED".equals(name)) {
                    capabilities.add(TeamCapability.valueOf(name));
                }
            });
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
}
