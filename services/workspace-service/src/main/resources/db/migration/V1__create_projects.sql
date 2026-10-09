CREATE TABLE projects (
    project_id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT projects_creator_name_uq UNIQUE (created_by, name)
);

CREATE INDEX projects_created_by_idx ON projects (created_by, created_at DESC);
