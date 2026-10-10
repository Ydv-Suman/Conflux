package com.conflux.workspaceservice.project.repository;

import com.conflux.workspaceservice.project.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

    @Query("""
            SELECT project FROM Project project
            JOIN ProjectTeam assignment ON assignment.project = project
            WHERE assignment.teamId = :teamId
            ORDER BY project.createdAt DESC
            """)
    List<Project> findAllByTeamId(@Param("teamId") UUID teamId);

    Optional<Project> findByProjectId(UUID projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT project FROM Project project WHERE project.projectId = :projectId")
    Optional<Project> findForUpdate(@Param("projectId") UUID projectId);
}
