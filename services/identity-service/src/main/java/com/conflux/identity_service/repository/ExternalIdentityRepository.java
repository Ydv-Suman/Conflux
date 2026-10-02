package com.conflux.identity_service.repository;

import com.conflux.identity_service.entity.AuthProvider;
import com.conflux.identity_service.entity.ExternalIdentity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ExternalIdentityRepository extends JpaRepository<ExternalIdentity, UUID> {

    Optional<ExternalIdentity> findByProviderAndProviderSubject(
            AuthProvider provider, String providerSubject);

    boolean existsByUserUserIdAndProvider(UUID userId, AuthProvider provider);
}
