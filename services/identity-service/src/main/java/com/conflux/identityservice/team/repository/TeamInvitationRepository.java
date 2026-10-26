package com.conflux.identityservice.team.repository;

import com.conflux.identityservice.team.entity.TeamInvitation;
import com.conflux.identityservice.team.entity.InvitationStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TeamInvitationRepository extends JpaRepository<TeamInvitation, UUID> {
    @Query("SELECT i.team.teamId FROM TeamInvitation i WHERE i.invitationId = :id AND i.invitee.userId = :userId")
    Optional<UUID> findTeamIdForInvitee(@Param("id") UUID id, @Param("userId") UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM TeamInvitation i WHERE i.invitationId = :id")
    Optional<TeamInvitation> findForUpdate(@Param("id") UUID id);

    List<TeamInvitation> findTop100ByInviteeUserIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
            UUID userId, InvitationStatus status, Instant now);

    List<TeamInvitation> findTop100ByTeamTeamIdOrderByCreatedAtDesc(UUID teamId);

    boolean existsByTeamTeamIdAndInviteeUserIdAndStatus(UUID teamId, UUID userId, InvitationStatus status);

    @Modifying
    @Query("""
            UPDATE TeamInvitation i SET i.status = com.conflux.identityservice.team.entity.InvitationStatus.EXPIRED
            WHERE i.team.teamId = :teamId AND i.invitee.userId = :userId
              AND i.status = com.conflux.identityservice.team.entity.InvitationStatus.PENDING
              AND i.expiresAt <= :now
            """)
    int expirePending(@Param("teamId") UUID teamId, @Param("userId") UUID userId, @Param("now") Instant now);
}
