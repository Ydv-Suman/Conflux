package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.team.entity.Team;
import com.conflux.identityservice.team.repository.TeamRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TeamSummaryLookupServiceTests {

    private final TeamRepository teams = mock(TeamRepository.class);
    private final TeamSummaryLookupService service = new TeamSummaryLookupService(teams);

    @Test
    void returnsOnlyTeamMetadata() {
        UUID teamId = UUID.randomUUID();
        Team team = new Team();
        team.setTeamId(teamId);
        team.setName("Authentication");
        team.setDescription("Identity and access");
        when(teams.findAllById(List.of(teamId))).thenReturn(List.of(team));

        TeamSummaryLookupService.TeamSummary result = service.findAll(List.of(teamId)).getFirst();

        assertEquals(teamId, result.teamId());
        assertEquals("Authentication", result.name());
        assertEquals("Identity and access", result.description());
    }
}
