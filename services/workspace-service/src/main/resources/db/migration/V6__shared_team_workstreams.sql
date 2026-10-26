ALTER TABLE workstreams ADD COLUMN default_workstream BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workstreams ALTER COLUMN base_revision DROP NOT NULL;
ALTER TABLE workstreams ALTER COLUMN current_revision DROP NOT NULL;

-- Preserve every existing stream; use the oldest unfinished one as the team's shared stream.
WITH candidates AS (
    SELECT DISTINCT ON (project_id, team_id) workstream_id
    FROM workstreams WHERE status NOT IN ('MERGED', 'ARCHIVED')
    ORDER BY project_id, team_id, created_at, workstream_id
)
UPDATE workstreams SET default_workstream = TRUE
WHERE workstream_id IN (SELECT workstream_id FROM candidates);

INSERT INTO workstreams (workstream_id, project_id, team_id, name, branch_name,
    status, created_by, created_at, updated_at, default_workstream)
SELECT gen_random_uuid(), a.project_id, a.team_id, 'Team workspace',
    'conflux/team/' || a.team_id, 'CREATED', a.added_by, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE
FROM project_teams a
WHERE NOT EXISTS (SELECT 1 FROM workstreams w
    WHERE w.project_id = a.project_id AND w.team_id = a.team_id AND w.default_workstream);

CREATE UNIQUE INDEX workstreams_default_team_uq ON workstreams (project_id, team_id)
    WHERE default_workstream;
ALTER TABLE workstreams ADD CONSTRAINT workstreams_repository_state_ck CHECK (
    (base_revision IS NOT NULL AND current_revision IS NOT NULL)
    OR (default_workstream AND base_revision IS NULL AND current_revision IS NULL
        AND status IN ('CREATED', 'BLOCKED'))
);
ALTER TABLE workstreams ADD CONSTRAINT workstreams_default_status_ck
    CHECK (NOT default_workstream OR status NOT IN ('MERGED', 'ARCHIVED'));
