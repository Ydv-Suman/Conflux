package com.conflux.identityservice.team.repository;

import com.conflux.identityservice.team.entity.TeamMember;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TeamMemberRepository extends JpaRepository<TeamMember, UUID> {

    Optional<TeamMember> findByTeamTeamIdAndUserUserId(UUID teamId, UUID userId);

    List<TeamMember> findAllByUserUserIdOrderByJoinedAt(UUID userId);

    @Query("""
            SELECT member FROM TeamMember member
            JOIN FETCH member.user user
            WHERE member.team.teamId = :teamId
              AND EXISTS (
                  SELECT 1 FROM TeamMember actor
                  WHERE actor.team.teamId = :teamId
                    AND actor.user.userId = :actorId
              )
            ORDER BY member.joinedAt
            """)
    List<TeamMember> findMembers(
            @Param("teamId") UUID teamId,
            @Param("actorId") UUID actorId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT member FROM TeamMember member
            WHERE member.team.teamId = :teamId
            ORDER BY member.joinedAt
            """)
    List<TeamMember> findAllForUpdate(@Param("teamId") UUID teamId);

    boolean existsByTeamTeamIdAndUserUserId(UUID teamId, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT member FROM TeamMember member WHERE member.user.userId = :userId")
    List<TeamMember> lockAllForUser(@Param("userId") UUID userId);

    @Query(value = """
            SELECT EXISTS (
                SELECT 1 FROM team_members member
                WHERE member.user_id = :userId
                  AND member.role = 'ADMIN'
                  AND NOT EXISTS (
                      SELECT 1 FROM team_members other
                      WHERE other.team_id = member.team_id
                        AND other.role = 'ADMIN'
                        AND other.user_id <> :userId
                  )
            )
            """, nativeQuery = true)
    boolean isSoleAdminOfAnyTeam(@Param("userId") UUID userId);
}
