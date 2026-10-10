package com.conflux.workspaceservice.project.repository;

import com.conflux.workspaceservice.project.entity.ProjectTeam;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ProjectTeamRepository extends JpaRepository<ProjectTeam, UUID> {

    List<ProjectTeam> findAllByProjectProjectIdOrderByAddedAt(UUID projectId);

    @Query("SELECT assignment.teamId FROM ProjectTeam assignment WHERE assignment.project.projectId = :projectId")
    List<UUID> findTeamIdsByProjectId(@Param("projectId") UUID projectId);

    boolean existsByProjectProjectIdAndTeamId(UUID projectId, UUID teamId);

    @Modifying
    long deleteByProjectProjectIdAndTeamId(UUID projectId, UUID teamId);
}
