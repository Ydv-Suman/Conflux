package com.conflux.workspaceservice.project.dto;

import com.conflux.workspaceservice.project.entity.RepositoryAccessMode;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class UpdateProjectRepositoryRequestDtoTests {
    static final ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
    static final Validator validator = factory.getValidator();
    static final String SHA = "a".repeat(40);

    @AfterAll
    static void close() { factory.close(); }

    @Test
    void acceptsSupportedAccessModesAndNormalizesSshAndRevision() {
        for (var mode : new RepositoryAccessMode[]{RepositoryAccessMode.PUBLIC, RepositoryAccessMode.HTTPS_CREDENTIAL_HELPER}) {
            var request = new UpdateProjectRepositoryRequestDto(" https://git.example.com/team/repo.git ", mode, " main ", "A".repeat(40), 0L);
            assertTrue(validator.validate(request).isEmpty());
            assertEquals(SHA, request.canonicalRevision());
            assertEquals("main", request.canonicalBranch());
        }
        var ssh = new UpdateProjectRepositoryRequestDto("git@git.example.com:team/repo.git", RepositoryAccessMode.SSH_AGENT, "team/shared", "b".repeat(64), 2L);
        assertEquals("ssh://git@git.example.com/team/repo.git", ssh.repositoryUrl());
        assertTrue(validator.validate(ssh).isEmpty());
        assertTrue(validator.validate(new UpdateProjectRepositoryRequestDto("ssh://git@git.example.com:2222/team/repo.git", RepositoryAccessMode.SSH_AGENT, "main", SHA, 0L)).isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"file:///tmp/repo", "/home/user/repo", "../repo", "http://git.example.com/repo", "git://git.example.com/repo",
            "https://user:token@git.example.com/repo", "https://token@git.example.com/repo", "https://git.example.com/repo?token=secret",
            "https://git.example.com/repo#secret", "https://git.example.com", "https://git.example.com/", "https://git.example.com/../repo",
            "https://git.example.com/%2e%2e/repo", "https://git.example.com/repo\nnext", "https://git.example.com:0/repo",
            "https://git.example.com:99999/repo", "ssh://git@git.example.com/team/repo.git"})
    void rejectsUnsafeOrIncompatiblePublicUrls(String url) {
        assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto(url, RepositoryAccessMode.PUBLIC, "main", SHA, 0L)).isEmpty(), url);
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://git.example.com/repo", "ssh://git:password@git.example.com/repo", "ssh://git.example.com/repo",
            "ssh://git%3Apassword@git.example.com/repo", "ssh://git@git.example.com/repo?token=secret"})
    void sshRequiresAnAgentUsernameWithoutPasswords(String url) {
        assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto(url, RepositoryAccessMode.SSH_AGENT, "main", SHA, 0L)).isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"../main", "--main", "main/", "a//b", "a/.b", "a.lock/b", "main.lock", "main.", "a..b", "@{-1}", "main new", "a\\b"})
    void rejectsUnsafeGitBranches(String branch) {
        assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto("https://git.example.com/repo", RepositoryAccessMode.PUBLIC, branch, SHA, 0L)).isEmpty());
    }

    @Test
    void requiresCompleteRevisionAccessAndVersion() {
        for (String revision : new String[]{"abcdef1", "HEAD", "main", "a".repeat(41), "g".repeat(40)}) {
            assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto("https://git.example.com/repo", RepositoryAccessMode.PUBLIC, "main", revision, 0L)).isEmpty());
        }
        assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto(null, null, null, null, null)).isEmpty());
        assertFalse(validator.validate(new UpdateProjectRepositoryRequestDto("https://git.example.com/repo", RepositoryAccessMode.PUBLIC, "main", SHA, -1L)).isEmpty());
    }
}
