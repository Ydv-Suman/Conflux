# Conflux Workspace Service

Spring Boot service that owns Conflux project and workstream metadata. It records the durable collaboration boundaries used by repositories, branches, worktrees, revisions, and merge workflows. Filesystem, Git, and terminal operations remain in the trusted Tauri/Rust runtime.

## Current scope

The service currently provides:

- authenticated project creation, listing, lookup, and update
- one default shared workstream per project/team, repository initialization, listing, lookup, update, and lifecycle transitions
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
GET  /api/projects
GET  /api/projects/{projectId}
PUT  /api/projects/{projectId}
DELETE /api/projects/{projectId}
GET  /api/projects/{projectId}/teams
POST /api/projects/{projectId}/teams
DELETE /api/projects/{projectId}/teams/{teamId}
```

Example create request:

```json
{
  "name": "Payments Platform",
  "description": "Payment services and shared repository metadata"
}
```

Projects are created without a team, and the creator is their owner. Owners can view and manage their projects, including assigning the first team. Project updates and team assignment are also available through `MANAGE_PROJECT`, which Identity grants only to the existing `ADMIN` and `TEAM_LEAD` roles for assigned teams. The project list contains projects owned by the authenticated user and projects connected to teams where that user has `VIEW_PROJECT`. Projects may have zero or more teams. Unauthorized resources return `404` to avoid exposing whether they exist.

Only the project creator may delete a project. Deletion also removes its team assignments and workstreams through database cascades.

A member of any team assigned to a project receives effective viewer access to the other teams' workstreams in that project. This does not create Identity Service team memberships and does not grant join, edit, create, approval, or management capabilities on those teams.

## Workstream API

```text
POST /api/projects/{projectId}/teams/{teamId}/workstreams
GET  /api/projects/{projectId}/teams/{teamId}/workstreams/default
PUT  /api/projects/{projectId}/teams/{teamId}/workstreams/default/repository
GET  /api/projects/{projectId}/teams/{teamId}/workstreams
GET  /api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}
PUT  /api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}
PUT  /api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}/status
```

Each project/team assignment has one default shared workstream. Assigning a team
creates it in the same transaction. Members open the same stream through
`GET .../workstreams/default`; they do not create separate streams for their tasks.
The response adds `defaultWorkstream` and `repositoryReady` flags.

A new default has `status: CREATED`, a planned branch `conflux/team/{teamId}`, and
null `baseRevision` / `currentRevision`. This represents pending repository setup,
not a fabricated Git commit. It cannot become active until initialized.

`PUT .../workstreams/default/repository` initializes the shared stream using the
request below. The existing POST workstreams route is an alias for that operation
and retains its 201 response for older callers. Initialization requires
`CREATE_WORKSTREAM`, validates Git metadata, and returns the existing default ID.
Repeating initialization with the same branch and base revision is idempotent;
requesting another branch or revision after setup returns 409. No additional
feature workstream is created. These are metadata operations; the desktop must
still validate Git results and implement project download before files are shared.

The shared stream cannot transition to `MERGED` or `ARCHIVED`, so members always
have a stable collaboration boundary. Existing non-default streams retain their
previous lifecycle and remain readable. Migration V6 preserves all old streams,
marks the oldest unfinished stream per project/team as default, and creates an
uninitialized default for assignments with no unfinished streams. Ties are resolved
by workstream UUID. Existing branches, revisions, and content are not changed.

A database index enforces one default per project/team, and project row locking
serializes initialization and team removal. New team assignments with only an
uninitialized default may be removed; assignments with initialized streams or
legacy workstream history remain protected from removal.

Default lookup uses the existing `VIEW_PROJECT` authorization, including read-only
cross-team project visibility. That visibility does not grant join, edit, or
repository-initialization privileges. The desktop should use `JOIN_WORKSTREAM`
and `EDIT_DOCUMENT` capabilities when entering a live session.

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
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED -> ARCHIVED
              |           |              |
              +-> BLOCKED +-> BLOCKED    +-> CONFLICT
```

Status changes use row locking so concurrent requests cannot bypass lifecycle checks. Completed workstreams cannot be renamed, and `ARCHIVED` is terminal. The public API cannot currently transition a workstream to `MERGED`; that transition remains reserved for the future trusted Git, test, review, and approval workflow. Archiving a merged workstream releases its branch name for a future workstream.

Every workstream belongs to exactly one team assigned to its project. Direct team capabilities control all changes. A member of another team assigned to the same project receives read-only viewer access, but cannot join or modify that team's workstream. Creating, renaming, and ordinary lifecycle changes require `CREATE_WORKSTREAM` on the owning team. Moving a workstream to `READY_TO_MERGE`, `CONFLICT`, or `ARCHIVED` requires `APPROVE_CHANGE` on that team.

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
- `V4__scope_workstreams_to_teams.sql`
- `V5__archive_workstreams.sql`
- `V6__shared_team_workstreams.sql`

Never edit a migration after it has been applied or merged. Add a new versioned migration for schema changes.

Projects created before `V3` remain accessible to their recorded creator and are intentionally not auto-assigned to a team. `V4` assigns existing workstreams only when their project has exactly one team; it stops instead of guessing when ownership is ambiguous.

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

- workstream participants
- repository download and trusted Git branch and worktree execution
- revision updates based on verified Git results
- merge approval and conflict-resolution workflows
- collaboration rooms, presence, chat, terminals, tasks, and agent runs

These features must not be implemented by trusting client-supplied user IDs, team IDs, roles, repository paths, or command arguments.
