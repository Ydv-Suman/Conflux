package com.conflux.identityservice.user.repository;

import com.conflux.identityservice.user.dto.UpdateUserRequestDto;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class UserSqlRepository {

    private static final String SELECT_PROFILE = """
            SELECT u.first_name, u.middle_name, u.last_name, u.username,
                   ue.email, ue.verified_at, u.created_at
            FROM users u
            JOIN user_emails ue ON ue.user_id = u.user_id
            WHERE u.user_id = :userId
            """;

    private final JdbcClient jdbc;

    public UserSqlRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<UserProfile> findProfile(UUID userId) {
        return jdbc.sql(SELECT_PROFILE)
                .param("userId", userId)
                .query((rs, row) -> new UserProfile(
                        rs.getString("first_name"),
                        rs.getString("middle_name"),
                        rs.getString("last_name"),
                        rs.getString("email"),
                        rs.getString("username"),
                        rs.getTimestamp("verified_at") != null,
                        rs.getTimestamp("created_at").toInstant()))
                .optional();
    }

    public int update(UUID userId, UpdateUserRequestDto request) {
        return jdbc.sql("""
                UPDATE users
                SET first_name = :firstName,
                    middle_name = :middleName,
                    last_name = :lastName,
                    username = :username,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId
                """)
                .param("firstName", request.firstName())
                .param("middleName", request.middleName())
                .param("lastName", request.lastName())
                .param("username", request.username())
                .param("userId", userId)
                .update();
    }

    public int delete(UUID userId) {
        return jdbc.sql("DELETE FROM users WHERE user_id = :userId")
                .param("userId", userId)
                .update();
    }

    public record UserProfile(
            String firstName,
            String middleName,
            String lastName,
            String email,
            String username,
            boolean emailVerified,
            Instant createdAt) {
    }
}
