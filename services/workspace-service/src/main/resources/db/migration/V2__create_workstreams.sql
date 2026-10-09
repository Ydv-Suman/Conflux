CREATE TABLE workstreams (
    workstream_id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    branch_name VARCHAR(200) NOT NULL,
    base_revision VARCHAR(64) NOT NULL,
    current_revision VARCHAR(64) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT workstreams_status_ck CHECK (
        status IN ('CREATED', 'ACTIVE', 'REVIEWING', 'READY_TO_MERGE', 'MERGED', 'BLOCKED', 'CONFLICT')
    )
);

CREATE UNIQUE INDEX workstreams_project_branch_uq
    ON workstreams (project_id, LOWER(branch_name));
CREATE INDEX workstreams_project_created_idx
    ON workstreams (project_id, created_at DESC);
