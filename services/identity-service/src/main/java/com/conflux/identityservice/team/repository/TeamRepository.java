package com.conflux.identityservice.team.repository;

import com.conflux.identityservice.team.entity.Team;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface TeamRepository extends JpaRepository<Team, UUID> {
}
