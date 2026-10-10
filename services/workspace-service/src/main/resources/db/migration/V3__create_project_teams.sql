CREATE TABLE project_teams (
    project_team_id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    added_by UUID NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT project_teams_project_team_uq UNIQUE (project_id, team_id)
);

CREATE INDEX project_teams_team_project_idx ON project_teams (team_id, project_id);
