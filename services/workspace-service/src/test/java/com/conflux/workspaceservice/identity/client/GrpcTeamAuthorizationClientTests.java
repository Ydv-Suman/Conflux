package com.conflux.workspaceservice.identity.client;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesResponse;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsRequest;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsResponse;
import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembership;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.identityservice.grpc.team.v1.TeamSummary;
import com.conflux.workspaceservice.identity.exception.IdentityServiceUnavailableException;
import io.grpc.Status;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
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
    void mapsMembershipList() {
        UUID teamId = UUID.randomUUID();
        when(stub.withDeadlineAfter(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(stub);
        when(stub.listMemberships(any(ListTeamMembershipsRequest.class))).thenReturn(
                ListTeamMembershipsResponse.newBuilder()
                        .addMemberships(TeamMembership.newBuilder()
                                .setTeamId(teamId.toString())
                                .addCapabilities(TeamCapability.TEAM_CAPABILITY_MANAGE_PROJECT))
                        .build());
        GrpcTeamAuthorizationClient client =
                new GrpcTeamAuthorizationClient(stub, Duration.ofSeconds(2));

        var result = client.listMemberships(UUID.randomUUID()).getFirst();

        assertEquals(teamId, result.teamId());
        assertTrue(result.has(
                com.conflux.workspaceservice.identity.model.TeamCapability.MANAGE_PROJECT));
    }

    @Test
    void mapsSafeTeamSummaries() {
        UUID teamId = UUID.randomUUID();
        when(stub.withDeadlineAfter(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(stub);
        when(stub.getTeamSummaries(any(GetTeamSummariesRequest.class))).thenReturn(
                GetTeamSummariesResponse.newBuilder()
                        .addTeams(TeamSummary.newBuilder()
                                .setTeamId(teamId.toString())
                                .setName("Payments")
                                .setDescription("Payment services"))
                        .build());
        GrpcTeamAuthorizationClient client =
                new GrpcTeamAuthorizationClient(stub, Duration.ofSeconds(2));

        var result = client.getTeamSummaries(List.of(teamId)).getFirst();

        assertEquals(teamId, result.teamId());
        assertEquals("Payments", result.name());
        assertEquals("Payment services", result.description());
    }

    @Test
    void batchesLargeTeamSummaryRequests() {
        when(stub.withDeadlineAfter(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(stub);
        when(stub.getTeamSummaries(any(GetTeamSummariesRequest.class)))
                .thenReturn(GetTeamSummariesResponse.getDefaultInstance());
        GrpcTeamAuthorizationClient client =
                new GrpcTeamAuthorizationClient(stub, Duration.ofSeconds(2));
        List<UUID> teamIds = java.util.stream.IntStream.range(0, 101)
                .mapToObj(ignored -> UUID.randomUUID())
                .toList();

        client.getTeamSummaries(teamIds);

        verify(stub, times(2)).getTeamSummaries(any(GetTeamSummariesRequest.class));
    }

    @Test
    void invalidDeadlineIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> new GrpcTeamAuthorizationClient(stub, Duration.ZERO));
    }
}
