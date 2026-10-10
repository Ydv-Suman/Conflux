package com.conflux.workspaceservice.identity.client;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.workspaceservice.identity.exception.IdentityServiceUnavailableException;
import io.grpc.Status;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GrpcTeamAuthorizationClientTests {

    private final TeamAuthorizationGrpc.TeamAuthorizationBlockingStub stub =
            mock(TeamAuthorizationGrpc.TeamAuthorizationBlockingStub.class);

    @Test
    void mapsIdentityCapabilities() {
        when(stub.withDeadlineAfter(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(stub);
        when(stub.getMembership(any(GetTeamMembershipRequest.class))).thenReturn(
                TeamMembershipResponse.newBuilder()
                        .setIsMember(true)
                        .addCapabilities(TeamCapability.TEAM_CAPABILITY_VIEW_PROJECT)
                        .build());
        GrpcTeamAuthorizationClient client = new GrpcTeamAuthorizationClient(stub, Duration.ofSeconds(2));

        var result = client.getAuthorization(UUID.randomUUID(), UUID.randomUUID());

        assertTrue(result.has(com.conflux.workspaceservice.identity.model.TeamCapability.VIEW_PROJECT));
    }

    @Test
    void unavailableIdentityFailsClosed() {
        when(stub.withDeadlineAfter(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(stub);
        when(stub.getMembership(any(GetTeamMembershipRequest.class)))
                .thenThrow(Status.UNAVAILABLE.asRuntimeException());
        GrpcTeamAuthorizationClient client = new GrpcTeamAuthorizationClient(stub, Duration.ofSeconds(2));

        assertThrows(IdentityServiceUnavailableException.class,
                () -> client.getAuthorization(UUID.randomUUID(), UUID.randomUUID()));
    }

    @Test
    void invalidDeadlineIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> new GrpcTeamAuthorizationClient(stub, Duration.ZERO));
    }
}
