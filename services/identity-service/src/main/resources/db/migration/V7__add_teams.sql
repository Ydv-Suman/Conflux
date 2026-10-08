CREATE TABLE teams (
    team_id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE team_members (
    membership_id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT team_members_team_user_uq UNIQUE (team_id, user_id),
    CONSTRAINT team_members_role_ck CHECK (
        role IN ('ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER')
    )
);

CREATE INDEX team_members_user_idx ON team_members (user_id);
CREATE INDEX team_members_team_role_idx ON team_members (team_id, role);
