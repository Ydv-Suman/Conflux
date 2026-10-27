# Local Compose databases

Run from the repository root:

```bash
docker compose -f infra/docker-compose/docker-compose.yml up -d database workspace-database
```

Compose defines two PostgreSQL services:

- `database`: `identityDB`, exposed on host port `5432`.
- `workspace-database`: `workspaceDB`, exposed on host port `5431`.

`POSTGRES_DB` creates the corresponding database on an empty data directory.
Flyway creates each service's tables when the application starts.

Storage paths default to the existing local identity and workspace data directories
and can be overridden with `POSTGRES_DATA_PATH` and `WORKSPACE_POSTGRES_DATA_PATH`.
Set `POSTGRES_PASSWORD` and `WORKSPACE_POSTGRES_PASSWORD` to match existing database
passwords; PostgreSQL does not reset passwords or create databases when reusing an
initialized data directory.

Stop the standalone `conflux_identity` and `conflux_workspace` containers before
starting these Compose services: they use the same ports and data directories.
