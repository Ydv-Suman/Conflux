ALTER TABLE workstreams ADD COLUMN team_id UUID;

UPDATE workstreams workstream
SET team_id = assignment.team_id
FROM project_teams assignment
WHERE assignment.project_id = workstream.project_id
  AND (
      SELECT COUNT(*)
      FROM project_teams candidate
      WHERE candidate.project_id = workstream.project_id
  ) = 1;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM workstreams WHERE team_id IS NULL) THEN
        RAISE EXCEPTION
            'Cannot infer team ownership for existing workstreams in multi-team projects';
    END IF;
END $$;

ALTER TABLE workstreams ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE workstreams
    ADD CONSTRAINT workstreams_project_team_fk
    FOREIGN KEY (project_id, team_id)
    REFERENCES project_teams (project_id, team_id)
    ON DELETE RESTRICT;

CREATE INDEX workstreams_project_team_created_idx
    ON workstreams (project_id, team_id, created_at DESC);
