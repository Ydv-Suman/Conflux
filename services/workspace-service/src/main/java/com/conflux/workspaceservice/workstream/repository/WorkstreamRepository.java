package com.conflux.workspaceservice.workstream.repository;

import com.conflux.workspaceservice.workstream.entity.Workstream;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkstreamRepository extends JpaRepository<Workstream, UUID> {

    Optional<Workstream> findByProjectProjectIdAndTeamIdAndDefaultWorkstreamTrue(UUID projectId, UUID teamId);

    @Query("""
            SELECT COUNT(w) > 0 FROM Workstream w
            WHERE w.project.projectId = :projectId AND w.teamId = :teamId
              AND (w.defaultWorkstream = false OR w.baseRevision IS NOT NULL)
            """)
    boolean existsBlockingTeamRemoval(@Param("projectId") UUID projectId, @Param("teamId") UUID teamId);

    @org.springframework.data.jpa.repository.Modifying
    @Query("""
            DELETE FROM Workstream w WHERE w.project.projectId = :projectId AND w.teamId = :teamId
              AND w.defaultWorkstream = true AND w.baseRevision IS NULL
            """)
    void deleteUninitializedDefault(@Param("projectId") UUID projectId, @Param("teamId") UUID teamId);

    List<Workstream> findAllByProjectProjectIdAndTeamIdOrderByCreatedAtDesc(
            UUID projectId, UUID teamId);

    Optional<Workstream> findByWorkstreamIdAndProjectProjectIdAndTeamId(
            UUID workstreamId, UUID projectId, UUID teamId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT workstream FROM Workstream workstream
            WHERE workstream.workstreamId = :workstreamId
              AND workstream.project.projectId = :projectId
              AND workstream.teamId = :teamId
            """)
    Optional<Workstream> findForUpdate(
            @Param("workstreamId") UUID workstreamId,
            @Param("projectId") UUID projectId,
            @Param("teamId") UUID teamId);
}
