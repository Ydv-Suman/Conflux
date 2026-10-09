package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.grpc.team.v1.GetTeamMembershipRequest;
import com.conflux.identityservice.grpc.team.v1.TeamCapability;
import com.conflux.identityservice.grpc.team.v1.TeamMembershipResponse;
import com.conflux.identityservice.grpc.team.v1.TeamRole;
import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.UserRole;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.Test;

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
    private final TeamAuthorizationGrpcService service = new TeamAuthorizationGrpcService(memberships);

    @Test
    void rejectsMalformedIdentifiers() {
        CapturingObserver observer = new CapturingObserver();

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
        CapturingObserver observer = new CapturingObserver();

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
        CapturingObserver observer = new CapturingObserver();

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
        CapturingObserver observer = new CapturingObserver();

        service.getMembership(request(userId, teamId), observer);

        StatusRuntimeException failure = assertInstanceOf(StatusRuntimeException.class, observer.error);
        assertEquals(Status.Code.INTERNAL, failure.getStatus().getCode());
        assertEquals("Authorization lookup failed", failure.getStatus().getDescription());
    }

    private GetTeamMembershipRequest request(UUID userId, UUID teamId) {
        return GetTeamMembershipRequest.newBuilder()
                .setUserId(userId.toString())
                .setTeamId(teamId.toString())
                .build();
    }

    private static final class CapturingObserver implements StreamObserver<TeamMembershipResponse> {

        private TeamMembershipResponse value;
        private Throwable error;
        private boolean completed;

        @Override
        public void onNext(TeamMembershipResponse value) {
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
