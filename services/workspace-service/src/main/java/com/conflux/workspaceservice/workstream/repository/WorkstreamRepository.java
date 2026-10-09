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

    List<Workstream> findAllByProjectProjectIdAndProjectCreatedByOrderByCreatedAtDesc(
            UUID projectId, UUID projectOwnerId);

    Optional<Workstream> findByWorkstreamIdAndProjectProjectIdAndProjectCreatedBy(
            UUID workstreamId, UUID projectId, UUID projectOwnerId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT workstream FROM Workstream workstream
            WHERE workstream.workstreamId = :workstreamId
              AND workstream.project.projectId = :projectId
              AND workstream.project.createdBy = :projectOwnerId
            """)
    Optional<Workstream> findForUpdate(
            @Param("workstreamId") UUID workstreamId,
            @Param("projectId") UUID projectId,
            @Param("projectOwnerId") UUID projectOwnerId);
}
