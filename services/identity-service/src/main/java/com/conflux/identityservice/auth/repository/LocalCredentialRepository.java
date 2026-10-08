package com.conflux.identityservice.auth.repository;

import com.conflux.identityservice.auth.entity.LocalCredential;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LocalCredentialRepository extends JpaRepository<LocalCredential, UUID> {
}
