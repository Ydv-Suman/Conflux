# Conflux Workspace Service

Spring Boot service that owns Conflux project and workstream metadata. It records the durable collaboration boundaries used by repositories, branches, worktrees, revisions, and merge workflows. Filesystem, Git, and terminal operations remain in the trusted Tauri/Rust runtime.

## Current scope

The service currently provides:

- authenticated project creation, listing, lookup, and update
- authenticated workstream creation, listing, lookup, update, and lifecycle transitions
- PostgreSQL persistence managed by Flyway
- team-scoped authorization verified through the Identity Service gRPC API
- validation for project data, Git branch names, and Git revision hashes
- structured API validation, not-found, and conflict responses

Projects can be assigned to one or more teams. Workspace Service accepts team identifiers only as resource selectors; it always verifies the authenticated user's membership and capability with Identity Service before reading or changing data.

## Requirements

- Java 25
- Docker
- a running Conflux Identity Service to issue access tokens for manual API testing

## PostgreSQL

Create the local database container:

```bash
docker run --name conflux_workspace \
  -e POSTGRES_PASSWORD=workspace123 \
  -e POSTGRES_DB=workspaceDB \
  -p 5431:5432 \
  -v ~/Desktop/pgdata:/var/lib/postgresql \
  -d postgres:18
```

For later sessions:

```bash
docker start conflux_workspace
```

If the mounted directory was initialized previously, PostgreSQL does not reapply `POSTGRES_PASSWORD` or create `POSTGRES_DB`. Create the database and align the local password explicitly instead of deleting existing data.

## Environment

Create the ignored local configuration file:

```bash
cd services/workspace-service
mkdir -p secrets
chmod 700 secrets
touch secrets/.env
chmod 600 secrets/.env
```

Add the local settings:

```properties
DB_URL=jdbc:postgresql://localhost:5431/workspaceDB
DB_USERNAME=postgres
DB_PASSWORD=workspace123
JWT_ISSUER=http://localhost:8080
JWT_AUDIENCE=conflux-api
JWT_PUBLIC_KEY=file:../identity-service/secrets/jwt-public.pem
CORS_ALLOWED_ORIGINS=http://localhost:5173
FORWARD_HEADERS_STRATEGY=none
IDENTITY_GRPC_TARGET=localhost:9090
IDENTITY_GRPC_DEADLINE=2s
IDENTITY_GRPC_PLAINTEXT=true
INTERNAL_GRPC_TOKEN=replace-with-the-same-random-32-plus-character-token-used-by-identity
```

The complete `secrets/` directory is ignored by Git. Never commit database credentials, internal service tokens, or JWT keys. Workspace Service only needs the Identity Service public key and must never receive its private signing key. Plaintext gRPC is an explicit local-development option; leave it disabled and use TLS outside local development.

Use exact CORS origins. Wildcard origins are rejected at startup. In production, mount the JWT public key read-only and inject database credentials from the deployment secret manager.

## Run locally

From the service directory:

```bash
./mvnw spring-boot:run
```

The service listens on `http://localhost:9000`. The health endpoint is public:

```text
GET /actuator/health
```

All `/api/**` endpoints require an Identity Service access token:

```http
Authorization: Bearer <access-token>
```

The token signature, expiration, issuer, audience, subject, token ID, and session ID formats are validated. Resource ownership is always derived from the validated token subject; clients cannot select another owner ID in a request.

## Project API

```text
POST /api/projects
GET  /api/projects?teamId={teamId}
GET  /api/projects/{projectId}
PUT  /api/projects/{projectId}
GET  /api/projects/{projectId}/teams
POST /api/projects/{projectId}/teams
DELETE /api/projects/{projectId}/teams/{teamId}
```

Example create request:

```json
{
  "name": "Payments Platform",
  "description": "Payment services and shared repository metadata",
  "teamId": "3a9422a7-fbbf-455e-9c3c-da40e2e78ad9"
}
```

Project creation, project updates, and team assignment require `CREATE_PROJECT`. Reads require `VIEW_PROJECT`. A capability granted through any team assigned to a project authorizes that operation. Unauthorized resources return `404` to avoid exposing whether they exist.

## Workstream API

```text
POST /api/projects/{projectId}/workstreams
GET  /api/projects/{projectId}/workstreams
GET  /api/projects/{projectId}/workstreams/{workstreamId}
PUT  /api/projects/{projectId}/workstreams/{workstreamId}
PUT  /api/projects/{projectId}/workstreams/{workstreamId}/status
```

Example create request:

```json
{
  "name": "Authentication refresh tokens",
  "branchName": "feature/auth-refresh",
  "baseRevision": "7f9a21c"
}
```

Branch names are restricted before they can become inputs to local Git operations. The trusted Tauri/Rust runtime must still validate repository paths and Git arguments before executing commands.

Workstream lifecycle target:

```text
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED
              |           |              |
              +-> BLOCKED +-> BLOCKED    +-> CONFLICT
```

Status changes use row locking so concurrent requests cannot bypass lifecycle checks. `MERGED` is terminal, and merged workstreams cannot be renamed. The public API cannot currently transition a workstream to `MERGED`; that transition remains reserved for the future trusted Git, test, review, and approval workflow.

Reading workstreams requires `VIEW_PROJECT`; creating, renaming, and ordinary lifecycle changes require `CREATE_WORKSTREAM`. Moving a workstream to `READY_TO_MERGE` or `CONFLICT` requires `APPROVE_CHANGE`.

Example status request:

```json
{
  "status": "ACTIVE"
}
```

## Database migrations

Flyway migrations are stored in:

```text
src/main/resources/db/migration/
```

Current migrations:

- `V1__create_projects.sql`
- `V2__create_workstreams.sql`
- `V3__create_project_teams.sql`

Never edit a migration after it has been applied or merged. Add a new versioned migration for schema changes.

Projects created before `V3` have no trustworthy team association and are intentionally not auto-assigned. Assign them through a controlled data migration with a verified team ID before enabling this version against existing production data.

## Package structure

```text
com.conflux.workspaceservice
├── project
│   ├── controller
│   ├── dto
│   ├── entity
│   ├── exception
│   ├── repository
│   └── service
├── workstream
│   ├── controller
│   ├── dto
│   ├── entity
│   ├── exception
│   ├── repository
│   └── service
├── security
└── shared
    ├── config
    ├── dto
    └── exception
```

Keep new business features grouped by feature. Cross-feature infrastructure belongs under `shared`, while authentication and request security belong under `security`.

## Tests

Run the complete verification suite:

```bash
./mvnw verify
```

Tests must cover authorization failures, validation boundaries, lifecycle transitions, persistence migrations, and the Spring application context.

## Deferred integrations

The following are intentionally deferred until their required boundary exists:

- project member aggregation across assigned teams
- workstream participants
- trusted Git branch and worktree execution
- revision updates based on verified Git results
- merge approval and conflict-resolution workflows
- collaboration rooms, presence, chat, terminals, tasks, and agent runs

These features must not be implemented by trusting client-supplied user IDs, team IDs, roles, repository paths, or command arguments.
