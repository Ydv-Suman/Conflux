package com.conflux.identity_service.service;

import com.conflux.identity_service.entity.AuthProvider;
import com.conflux.identity_service.entity.ExternalIdentity;
import com.conflux.identity_service.entity.User;
import com.conflux.identity_service.exception.IdentityAlreadyLinkedException;
import com.conflux.identity_service.repository.ExternalIdentityRepository;
import com.conflux.identity_service.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
public class ExternalIdentityService {

    private final ExternalIdentityRepository identityRepository;
    private final UserRepository userRepository;

    public ExternalIdentityService(
            ExternalIdentityRepository identityRepository,
            UserRepository userRepository) {
        this.identityRepository = identityRepository;
        this.userRepository = userRepository;
    }

    public Optional<UUID> resolveGithubUser(String githubUserId) {
        return identityRepository
                .findByProviderAndProviderSubject(AuthProvider.GITHUB, githubUserId)
                .map(identity -> identity.getUser().getUserId());
    }

    @Transactional
    public void linkGithub(UUID userId, String githubUserId) {
        ExternalIdentity existing = identityRepository
                .findByProviderAndProviderSubject(AuthProvider.GITHUB, githubUserId)
                .orElse(null);
        if (existing != null) {
            if (existing.getUser().getUserId().equals(userId)) {
                return;
            }
            throw new IdentityAlreadyLinkedException("GitHub account is linked to another user");
        }
        if (identityRepository.existsByUserUserIdAndProvider(userId, AuthProvider.GITHUB)) {
            throw new IdentityAlreadyLinkedException("User already has a linked GitHub account");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("User not found"));
        ExternalIdentity identity = new ExternalIdentity();
        identity.setUser(user);
        identity.setProvider(AuthProvider.GITHUB);
        identity.setProviderSubject(githubUserId);
        identityRepository.save(identity);
    }
}
