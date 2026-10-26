package com.conflux.workspaceservice.workstream.service;

import com.conflux.workspaceservice.identity.client.TeamAuthorizationClient;
import com.conflux.workspaceservice.identity.model.TeamCapability;
import com.conflux.workspaceservice.identity.model.TeamAuthorization;
import com.conflux.workspaceservice.identity.model.TeamSummary;
import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRepositoryRequestDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.entity.RepositoryAccessMode;
import com.conflux.workspaceservice.project.service.ProjectService;
import com.conflux.workspaceservice.project.exception.ProjectNotFoundException;
import com.conflux.workspaceservice.project.exception.ProjectConflictException;
import com.conflux.workspaceservice.workstream.dto.CreateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.exception.WorkstreamConflictException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.annotation.DirtiesContext;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SharedWorkstreamIntegrationTests {
    @Container
    static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:18");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", database::getJdbcUrl);
        registry.add("spring.datasource.username", database::getUsername);
        registry.add("spring.datasource.password", database::getPassword);
    }

    @Autowired ProjectService projects;
    @Autowired WorkstreamService workstreams;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean TeamAuthorizationClient identity;
    final UUID owner = UUID.randomUUID();
    final UUID member = UUID.randomUUID();
    final UUID teamId = UUID.randomUUID();
    UUID projectId;

    @BeforeEach
    void setup() {
        when(identity.getAuthorization(any(), eq(teamId))).thenReturn(
                new TeamAuthorization(true, Set.of(TeamCapability.MANAGE_PROJECT,
                        TeamCapability.CREATE_WORKSTREAM, TeamCapability.VIEW_PROJECT)));
        when(identity.getTeamSummaries(List.of(teamId))).thenReturn(List.of(new TeamSummary(teamId, "Team", "Test")));
        projectId = projects.create(owner, new CreateProjectRequestDto("shared-" + UUID.randomUUID(), null)).projectId();
        projects.assignTeam(owner, projectId, teamId);
    }

    @AfterEach
    void cleanup() {
        if (projectId != null) {
            jdbc.update("DELETE FROM workstreams WHERE project_id = ?", projectId);
            jdbc.update("DELETE FROM project_teams WHERE project_id = ?", projectId);
            jdbc.update("DELETE FROM projects WHERE project_id = ?", projectId);
        }
    }

    @Test
    void assignmentCreatesOneSharedWorkstreamVisibleToAllMembers() {
        var first = workstreams.getDefault(owner, projectId, teamId);
        var second = workstreams.getDefault(member, projectId, teamId);
        assertEquals(first.workstreamId(), second.workstreamId());
        assertTrue(first.defaultWorkstream());
        assertFalse(first.repositoryReady());
        assertNull(first.baseRevision());
        assertEquals(1, count());
        assertEquals(first.workstreamId(), workstreams.list(member, projectId, teamId).getFirst().workstreamId());
    }

    @Test
    void concurrentInitializationReturnsSameIdAndCreatesNoExtraWorkstreams() throws Exception {
        var barrier = new CyclicBarrier(2);
        var request = new CreateWorkstreamRequestDto("Shared", "team/shared", "abcdef1");
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { barrier.await(); return workstreams.create(owner, projectId, teamId, request); });
            var second = executor.submit(() -> { barrier.await(); return workstreams.create(member, projectId, teamId, request); });
            var result = first.get(20, TimeUnit.SECONDS);
            assertEquals(result.workstreamId(), second.get(20, TimeUnit.SECONDS).workstreamId());
            assertTrue(result.repositoryReady());
        }
        assertEquals(1, count());
        assertThrows(WorkstreamConflictException.class, () -> workstreams.create(owner, projectId, teamId,
                new CreateWorkstreamRequestDto("Other", "feature/other", "1234567")));
    }

    @Test
    void uninitializedAssignmentCanBeRemovedButInitializedOneIsProtected() {
        projects.removeTeam(owner, projectId, teamId);
        assertEquals(0, count());
        projects.assignTeam(owner, projectId, teamId);
        workstreams.create(owner, projectId, teamId, new CreateWorkstreamRequestDto("Shared", "team/shared", "abcdef1"));
        assertThrows(ProjectConflictException.class, () -> projects.removeTeam(owner, projectId, teamId));
        assertEquals(1, count());
    }

    @Test
    void unrelatedUserCannotReadOrInitializeDefault() {
        UUID stranger = UUID.randomUUID();
        when(identity.getAuthorization(stranger, teamId)).thenReturn(new TeamAuthorization(false, Set.of()));
        when(identity.listMemberships(stranger)).thenReturn(List.of());
        assertThrows(ProjectNotFoundException.class, () -> workstreams.getDefault(stranger, projectId, teamId));
        assertThrows(ProjectNotFoundException.class, () -> workstreams.create(stranger, projectId, teamId,
                new CreateWorkstreamRequestDto("Shared", "team/shared", "abcdef1")));
        assertFalse(workstreams.getDefault(owner, projectId, teamId).repositoryReady());
    }

    @Test
    void repositoryConfigurationPersistsWithoutChangingExistingWorkstreams() {
        assertNull(projects.getRepository(owner, projectId));
        var shared = workstreams.getDefault(owner, projectId, teamId);
        var configured = projects.updateRepository(owner, projectId, repositoryRequest(0));
        assertEquals(1, configured.version());
        assertEquals(configured, projects.getRepository(member, projectId));
        projects.update(owner, projectId, new UpdateProjectRequestDto("Renamed", null));
        assertEquals(configured, projects.getRepository(owner, projectId));
        assertEquals(shared, workstreams.getDefault(owner, projectId, teamId));
        var updated = projects.updateRepository(owner, projectId, new UpdateProjectRepositoryRequestDto(
                "git@git.example.com:team/repo.git", RepositoryAccessMode.SSH_AGENT, "release", "b".repeat(40), 1L));
        assertEquals(2, updated.version());
        assertEquals("ssh://git@git.example.com/team/repo.git", projects.getRepository(member, projectId).repositoryUrl());
    }

    @Test
    void developersCanReadRepositoryButOnlyProjectManagersCanConfigureIt() {
        when(identity.getAuthorization(member, teamId)).thenReturn(new TeamAuthorization(true, Set.of(TeamCapability.VIEW_PROJECT)));
        projects.updateRepository(owner, projectId, repositoryRequest(0));
        assertNotNull(projects.getRepository(member, projectId));
        assertThrows(ProjectNotFoundException.class, () -> projects.updateRepository(member, projectId, repositoryRequest(1)));
        when(identity.getAuthorization(member, teamId)).thenReturn(new TeamAuthorization(true, Set.of(TeamCapability.MANAGE_PROJECT)));
        assertEquals(2, projects.updateRepository(member, projectId, repositoryRequest(1)).version());
    }

    @Test
    void pendingInvitesUnrelatedAndRemovedMembersCannotReadOrWriteRepository() {
        projects.updateRepository(owner, projectId, repositoryRequest(0));
        UUID outsider = UUID.randomUUID();
        when(identity.getAuthorization(outsider, teamId)).thenReturn(new TeamAuthorization(false, Set.of()));
        assertThrows(ProjectNotFoundException.class, () -> projects.getRepository(outsider, projectId));
        assertThrows(ProjectNotFoundException.class, () -> projects.updateRepository(outsider, projectId, repositoryRequest(1)));
        assertNotNull(projects.getRepository(member, projectId));
        when(identity.getAuthorization(member, teamId)).thenReturn(new TeamAuthorization(false, Set.of()));
        assertThrows(ProjectNotFoundException.class, () -> projects.getRepository(member, projectId));
    }

    @Test
    void concurrentRepositoryUpdatesHaveExactlyOneWinner() throws Exception {
        var barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Boolean> update = () -> {
                barrier.await();
                try { projects.updateRepository(owner, projectId, repositoryRequest(0)); return true; }
                catch (ProjectConflictException stale) { return false; }
            };
            var first = executor.submit(update); var second = executor.submit(update);
            assertNotEquals(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        }
        assertEquals(1, projects.getRepository(owner, projectId).version());
        assertThrows(ProjectConflictException.class, () -> projects.updateRepository(owner, projectId, repositoryRequest(0)));
    }

    private UpdateProjectRepositoryRequestDto repositoryRequest(long version) {
        return new UpdateProjectRepositoryRequestDto("https://git.example.com/team/repo.git",
                RepositoryAccessMode.HTTPS_CREDENTIAL_HELPER, "main", "a".repeat(40), version);
    }

    private int count() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM workstreams WHERE project_id = ? AND team_id = ?",
                Integer.class, projectId, teamId);
    }
}
