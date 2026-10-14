ALTER TABLE workstreams DROP CONSTRAINT workstreams_status_ck;

ALTER TABLE workstreams
    ADD CONSTRAINT workstreams_status_ck CHECK (
        status IN ('CREATED', 'ACTIVE', 'REVIEWING', 'READY_TO_MERGE',
                   'MERGED', 'ARCHIVED', 'BLOCKED', 'CONFLICT')
    );

DROP INDEX workstreams_project_branch_uq;

CREATE UNIQUE INDEX workstreams_active_project_branch_uq
    ON workstreams (project_id, LOWER(branch_name))
    WHERE status <> 'ARCHIVED';
