package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesRequest;
import com.conflux.identityservice.grpc.team.v1.GetTeamSummariesResponse;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsRequest;
import com.conflux.identityservice.grpc.team.v1.ListTeamMembershipsResponse;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.identityservice.grpc.team.v1.TeamRole;
import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.UserRole;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TeamAuthorizationGrpcServiceTests {

    private final TeamMembershipLookupService memberships = mock(TeamMembershipLookupService.class);
    private final TeamSummaryLookupService summaries = mock(TeamSummaryLookupService.class);
    private final TeamAuthorizationGrpcService service =
            new TeamAuthorizationGrpcService(memberships, summaries);

    @Test
    void rejectsMalformedIdentifiers() {
        CapturingObserver<TeamMembershipResponse> observer = new CapturingObserver<>();

        service.getMembership(GetTeamMembershipRequest.newBuilder()
                .setUserId("invalid")
                .setTeamId(UUID.randomUUID().toString())
                .build(), observer);

        StatusRuntimeException failure = assertInstanceOf(StatusRuntimeException.class, observer.error);
        assertEquals(Status.Code.INVALID_ARGUMENT, failure.getStatus().getCode());
    }

    @Test
    void returnsRoleAndCapabilitiesForMember() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(memberships.find(userId, teamId)).thenReturn(Optional.of(
                new TeamMembershipLookupService.Membership(
                        UserRole.TEAM_LEAD,
                        Set.of(Capability.VIEW_PROJECT, Capability.CREATE_WORKSTREAM))));
        CapturingObserver<TeamMembershipResponse> observer = new CapturingObserver<>();

        service.getMembership(request(userId, teamId), observer);

        assertTrue(observer.value.getIsMember());
        assertEquals(TeamRole.TEAM_ROLE_TEAM_LEAD, observer.value.getRole());
        assertTrue(observer.value.getCapabilitiesList().contains(TeamCapability.TEAM_CAPABILITY_VIEW_PROJECT));
        assertTrue(observer.value.getCapabilitiesList().contains(
                TeamCapability.TEAM_CAPABILITY_CREATE_WORKSTREAM));
        assertTrue(observer.completed);
    }

    @Test
    void returnsNoIdentityDataForNonMember() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(memberships.find(userId, teamId)).thenReturn(Optional.empty());
        CapturingObserver<TeamMembershipResponse> observer = new CapturingObserver<>();

        service.getMembership(request(userId, teamId), observer);

        assertFalse(observer.value.getIsMember());
        assertEquals(TeamRole.TEAM_ROLE_UNSPECIFIED, observer.value.getRole());
        assertTrue(observer.value.getCapabilitiesList().isEmpty());
    }

    @Test
    void internalFailureDoesNotExposeExceptionDetails() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(memberships.find(userId, teamId))
                .thenThrow(new IllegalStateException("sensitive database detail"));
        CapturingObserver<TeamMembershipResponse> observer = new CapturingObserver<>();

        service.getMembership(request(userId, teamId), observer);

        StatusRuntimeException failure = assertInstanceOf(StatusRuntimeException.class, observer.error);
        assertEquals(Status.Code.INTERNAL, failure.getStatus().getCode());
        assertEquals("Authorization lookup failed", failure.getStatus().getDescription());
    }

    @Test
    void listsMembershipsWithoutExposingUserDetails() {
        UUID userId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();
        when(memberships.findAll(userId)).thenReturn(List.of(
                new TeamMembershipLookupService.TeamMembership(
                        teamId,
                        UserRole.TEAM_LEAD,
                        Set.of(Capability.VIEW_PROJECT, Capability.MANAGE_PROJECT))));
        CapturingObserver<ListTeamMembershipsResponse> observer = new CapturingObserver<>();

        service.listMemberships(ListTeamMembershipsRequest.newBuilder()
                .setUserId(userId.toString())
                .build(), observer);

        assertEquals(1, observer.value.getMembershipsCount());
        assertEquals(teamId.toString(), observer.value.getMemberships(0).getTeamId());
        assertEquals(TeamRole.TEAM_ROLE_TEAM_LEAD, observer.value.getMemberships(0).getRole());
        assertTrue(observer.value.getMemberships(0).getCapabilitiesList()
                .contains(TeamCapability.TEAM_CAPABILITY_MANAGE_PROJECT));
    }

    @Test
    void returnsOnlySafeTeamSummaryFields() {
        UUID teamId = UUID.randomUUID();
        when(summaries.findAll(List.of(teamId))).thenReturn(List.of(
                new TeamSummaryLookupService.TeamSummary(teamId, "Payments", "Payment services")));
        CapturingObserver<GetTeamSummariesResponse> observer = new CapturingObserver<>();

        service.getTeamSummaries(GetTeamSummariesRequest.newBuilder()
                .addTeamIds(teamId.toString())
                .build(), observer);

        assertEquals(1, observer.value.getTeamsCount());
        assertEquals(teamId.toString(), observer.value.getTeams(0).getTeamId());
        assertEquals("Payments", observer.value.getTeams(0).getName());
        assertEquals("Payment services", observer.value.getTeams(0).getDescription());
    }

    @Test
    void limitsTeamSummaryBatchSize() {
        GetTeamSummariesRequest.Builder request = GetTeamSummariesRequest.newBuilder();
        for (int index = 0; index < 101; index++) {
            request.addTeamIds(UUID.randomUUID().toString());
        }
        CapturingObserver<GetTeamSummariesResponse> observer = new CapturingObserver<>();

        service.getTeamSummaries(request.build(), observer);

        StatusRuntimeException failure = assertInstanceOf(StatusRuntimeException.class, observer.error);
        assertEquals(Status.Code.INVALID_ARGUMENT, failure.getStatus().getCode());
    }

    private GetTeamMembershipRequest request(UUID userId, UUID teamId) {
        return GetTeamMembershipRequest.newBuilder()
                .setUserId(userId.toString())
                .setTeamId(teamId.toString())
                .build();
    }

    private static final class CapturingObserver<T> implements StreamObserver<T> {

        private T value;
        private Throwable error;
        private boolean completed;

        @Override
        public void onNext(T value) {
            this.value = value;
        }

        @Override
        public void onError(Throwable error) {
            this.error = error;
        }

        @Override
        public void onCompleted() {
            completed = true;
        }
    }
}
