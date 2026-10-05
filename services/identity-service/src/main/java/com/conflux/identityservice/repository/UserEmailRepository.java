package com.conflux.identityservice.repository;

import com.conflux.identityservice.entity.UserEmail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserEmailRepository extends JpaRepository<UserEmail, UUID> {

    @Query(value = """
            SELECT * FROM user_emails
            WHERE email = :email AND verified_at IS NULL
            FOR UPDATE
            """, nativeQuery = true)
    Optional<UserEmail> findUnverifiedByEmailForUpdate(@Param("email") String email);
}
