ALTER TABLE projects
    ADD COLUMN repository_url VARCHAR(2048),
    ADD COLUMN repository_access_mode VARCHAR(30),
    ADD COLUMN canonical_branch VARCHAR(200),
    ADD COLUMN canonical_revision VARCHAR(64),
    ADD COLUMN repository_version BIGINT NOT NULL DEFAULT 0;

-- Existing local-only projects stay unconfigured until a manager supplies a remote.
ALTER TABLE projects ADD CONSTRAINT projects_repository_configuration_ck CHECK (
    (repository_version = 0 AND repository_url IS NULL AND repository_access_mode IS NULL
        AND canonical_branch IS NULL AND canonical_revision IS NULL)
    OR
    (repository_version > 0 AND repository_url IS NOT NULL AND length(repository_url) > 0
        AND repository_access_mode IS NOT NULL
        AND repository_access_mode IN ('PUBLIC', 'HTTPS_CREDENTIAL_HELPER', 'SSH_AGENT')
        AND canonical_branch IS NOT NULL AND length(canonical_branch) > 0
        AND canonical_revision IS NOT NULL AND canonical_revision ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);
