CREATE TABLE team_invitations (
    invitation_id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    invitee_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    proposed_role VARCHAR(30) NOT NULL CHECK (proposed_role IN
        ('ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER')),
    status VARCHAR(20) NOT NULL CHECK (status IN
        ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    CHECK (inviter_id <> invitee_id),
    CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX team_invitations_pending_uq
    ON team_invitations (team_id, invitee_id) WHERE status = 'PENDING';
CREATE INDEX team_invitations_inbox_idx ON team_invitations (invitee_id, status, created_at DESC);
CREATE INDEX team_invitations_team_idx ON team_invitations (team_id, created_at DESC);
