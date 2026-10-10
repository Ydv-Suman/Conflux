package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.team.repository.TeamRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Service
public class TeamSummaryLookupService {

    private final TeamRepository teams;

    public TeamSummaryLookupService(TeamRepository teams) {
        this.teams = teams;
    }

    @Transactional(readOnly = true)
    public List<TeamSummary> findAll(Collection<UUID> teamIds) {
        return teams.findAllById(teamIds).stream()
                .map(team -> new TeamSummary(
                        team.getTeamId(), team.getName(), team.getDescription()))
                .toList();
    }

    public record TeamSummary(UUID teamId, String name, String description) {
    }
}
