package com.conflux.identityservice.auth.repository;

import com.conflux.identityservice.auth.entity.AuthProvider;
import com.conflux.identityservice.auth.entity.ExternalIdentity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ExternalIdentityRepository extends JpaRepository<ExternalIdentity, UUID> {

    Optional<ExternalIdentity> findByProviderAndProviderSubject(
            AuthProvider provider, String providerSubject);

    boolean existsByUserUserIdAndProvider(UUID userId, AuthProvider provider);
}
