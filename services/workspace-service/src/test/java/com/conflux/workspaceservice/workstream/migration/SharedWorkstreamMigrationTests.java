package com.conflux.workspaceservice.workstream.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers(disabledWithoutDocker = true)
class SharedWorkstreamMigrationTests {
    @Container
    static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:18");

    @Test
    void migrationPreservesHistoryBackfillsDefaultsAndEnforcesUniqueness() {
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
                .target("5").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                database.getJdbcUrl(), database.getUsername(), database.getPassword()));
        UUID project = UUID.randomUUID(); UUID actor = UUID.randomUUID();
        UUID activeTeam = UUID.randomUUID(); UUID completedTeam = UUID.randomUUID(); UUID emptyTeam = UUID.randomUUID();
        jdbc.update("INSERT INTO projects (project_id, name, created_by, created_at, updated_at) "
                + "VALUES (?, 'Migration test', ?, NOW(), NOW())", project, actor);
        for (UUID team : new UUID[]{activeTeam, completedTeam, emptyTeam}) {
            jdbc.update("INSERT INTO project_teams VALUES (?, ?, ?, ?, NOW())", UUID.randomUUID(), project, team, actor);
        }
        UUID oldest = UUID.randomUUID(); UUID newer = UUID.randomUUID();
        seed(jdbc, oldest, project, activeTeam, actor, "ACTIVE", "feature/oldest", 2);
        seed(jdbc, newer, project, activeTeam, actor, "ACTIVE", "feature/newer", 1);
        seed(jdbc, UUID.randomUUID(), project, completedTeam, actor, "MERGED", "feature/merged", 2);
        seed(jdbc, UUID.randomUUID(), project, completedTeam, actor, "ARCHIVED", "feature/archived", 1);
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
        assertEquals(0L, jdbc.queryForObject("SELECT repository_version FROM projects WHERE project_id = ?", Long.class, project));
        assertNull(jdbc.queryForObject("SELECT repository_url FROM projects WHERE project_id = ?", String.class, project));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "UPDATE projects SET repository_url = 'https://git.example.com/repo' WHERE project_id = ?", project));
        assertEquals(6, jdbc.queryForObject("SELECT COUNT(*) FROM workstreams", Integer.class));
        assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM workstreams WHERE default_workstream", Integer.class));
        assertEquals(oldest, jdbc.queryForObject("SELECT workstream_id FROM workstreams WHERE team_id = ? AND default_workstream", UUID.class, activeTeam));
        assertEquals("abcdef1", jdbc.queryForObject("SELECT base_revision FROM workstreams WHERE workstream_id = ?", String.class, oldest));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM workstreams WHERE default_workstream AND base_revision IS NULL", Integer.class));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM workstreams WHERE status IN ('MERGED', 'ARCHIVED')", Integer.class));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "INSERT INTO workstreams (workstream_id, project_id, team_id, name, branch_name, status, created_by, created_at, updated_at, default_workstream) "
                        + "VALUES (?, ?, ?, 'Duplicate', 'another-branch', 'CREATED', ?, NOW(), NOW(), TRUE)",
                UUID.randomUUID(), project, activeTeam, actor));
    }

    private void seed(JdbcTemplate jdbc, UUID id, UUID project, UUID team, UUID actor, String status, String branch, int days) {
        jdbc.update("INSERT INTO workstreams (workstream_id, project_id, team_id, name, branch_name, base_revision, current_revision, status, created_by, created_at, updated_at) "
                + "VALUES (?, ?, ?, 'Existing', ?, 'abcdef1', 'abcdef1', ?, ?, NOW() - (? * INTERVAL '1 day'), NOW())",
                id, project, team, branch, status, actor, days);
    }
}
