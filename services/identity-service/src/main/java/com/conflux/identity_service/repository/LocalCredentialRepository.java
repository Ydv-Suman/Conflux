package com.conflux.identity_service.repository;

import com.conflux.identity_service.entity.LocalCredential;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LocalCredentialRepository extends JpaRepository<LocalCredential, UUID> {
}
