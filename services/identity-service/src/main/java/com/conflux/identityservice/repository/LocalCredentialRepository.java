package com.conflux.identityservice.repository;

import com.conflux.identityservice.entity.LocalCredential;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LocalCredentialRepository extends JpaRepository<LocalCredential, UUID> {
}
