package com.conflux.identityservice.grpc.team;

import com.conflux.identityservice.team.entity.Capability;
import com.conflux.identityservice.team.entity.TeamMember;
import com.conflux.identityservice.team.entity.UserRole;
import com.conflux.identityservice.team.repository.TeamMemberRepository;
import com.conflux.identityservice.team.service.TeamAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class TeamMembershipLookupService {

    private final TeamMemberRepository members;
    private final TeamAuthorizationService authorization;

    public TeamMembershipLookupService(
            TeamMemberRepository members, TeamAuthorizationService authorization) {
        this.members = members;
        this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public Optional<Membership> find(UUID userId, UUID teamId) {
        return members.findByTeamTeamIdAndUserUserId(teamId, userId)
                .map(member -> membership(member, authorization.capabilities(member.getRole())));
    }

    private Membership membership(TeamMember member, Set<Capability> capabilities) {
        return new Membership(member.getRole(), capabilities);
    }

    public record Membership(UserRole role, Set<Capability> capabilities) {

        public Membership {
            capabilities = Set.copyOf(capabilities);
        }
    }
}
