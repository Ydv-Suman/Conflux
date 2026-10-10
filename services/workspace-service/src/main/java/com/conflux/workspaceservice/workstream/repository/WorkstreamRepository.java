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

    List<Workstream> findAllByProjectProjectIdOrderByCreatedAtDesc(UUID projectId);

    Optional<Workstream> findByWorkstreamIdAndProjectProjectId(UUID workstreamId, UUID projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT workstream FROM Workstream workstream
            WHERE workstream.workstreamId = :workstreamId
              AND workstream.project.projectId = :projectId
            """)
    Optional<Workstream> findForUpdate(
            @Param("workstreamId") UUID workstreamId,
            @Param("projectId") UUID projectId);
}
