package com.conflux.identity_service.repository;

import com.conflux.identity_service.entity.UserEmail;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserEmailRepository extends JpaRepository<UserEmail, UUID> {

    Optional<UserEmail> findByEmail(String email);
}
