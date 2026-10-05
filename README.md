# Conflux

> Local-first multiplayer development with task-scoped AI engineering agents.

Conflux is a collaborative desktop development environment where humans and specialized AI agents work on the same project without forcing every feature into one shared working tree.

The core product model is:

```text
Team -> Project -> Workstream -> Task -> Agent Runs
```

Each workstream isolates an active feature while preserving team-wide visibility. Developers collaborate live inside a workstream, and AI work is produced as reviewable candidate patches rather than silently modifying canonical code.

## Why workstreams

Synchronizing every unfinished edit into one project-wide working tree creates interference: a temporary authentication change can break a teammate who is testing payments. Conflux treats a workstream as a collaborative feature branch with its own:

- branch and base revision;
- optional Git worktree;
- active collaborative documents;
- participants and presence;
- task and agent context;
- shared chat and terminal context;
- review, approval, and merge lifecycle.

```text
Project
├── Authentication workstream
│   ├── humans collaborating live
│   ├── Git branch/worktree
│   └── task-scoped agent runs
├── Payments workstream
└── Notifications workstream
```

Suggested lifecycle:

```text
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED
                        |               |
                        +-> BLOCKED     +-> CONFLICT
```

## Core principles

- **Local-first repository:** every developer works from a local repository replica.
- **Workstream isolation:** realtime synchronization stays within the active feature scope.
- **Team-wide visibility:** members can inspect other workstreams without receiving every unfinished edit.
- **Task-scoped AI:** Coder, Reviewer, and Security are logical roles instantiated as independent task runs.
- **Human authority:** consequential AI changes remain proposals until policy, validation, and approval requirements are met.
- **Git for durability, CRDT for immediacy:** Git records meaningful history; Yjs synchronizes active text documents.

## Realtime editing

Monaco renders local typing immediately. Yjs produces operations that the collaboration service relays asynchronously to other participants in the same workstream.

```text
Keystroke -> Monaco -> local Yjs document -> collaboration relay -> peers
```

Conflux does not CRDT-sync an entire repository. Collaborative state is activated for open text documents; Git and filesystem mechanisms manage the wider repository.

Presence, cursors, selections, and typing state are ephemeral. Collaborative document state is convergent and persisted locally.

## AI workflow

The team shares the logical roles `@Coder`, `@Reviewer`, and `@Security`, but each task receives independent runs with workstream-specific context.

```text
User task
   |
Orchestrator
   |
Coder -> Candidate Patch v1
              |
         +----+----+
         |         |
     Reviewer   Security
         |         |
         +----+----+
              |
           Findings
              |
            Coder
              |
       Candidate Patch v2
              |
            Tests
              |
       Human approval
              |
     Apply to workstream
```

The Coder normally creates candidate modifications. Reviewer and Security return findings. Before applying an approved patch, Conflux validates it against the latest workstream revision. A patch that overlaps newer human changes is marked stale or conflicting instead of overwriting them.

## Git and worktrees

Each active workstream maps to a Git branch and can use a dedicated worktree:

```text
project/main/

.conflux/worktrees/
├── auth-refresh/
├── payment-webhook/
└── notifications/
```

When `main` advances, Conflux informs active workstreams. Updating, rebasing, or merging a workstream is deliberate; Conflux does not silently rewrite active history.

Cross-workstream analysis compares changed files and regions so likely merge conflicts can be surfaced before pull-request time.

## Terminal and communication model

Each active workstream has one logical shared terminal. One designated machine owns the PTY, authorized collaborators receive streamed output, and one controller provides interactive input at a time. AI agents should prefer structured operations such as build, test, lint, and Git status; arbitrary shell access remains policy-controlled.

Communication is separated into:

- **Team/project chat:** architecture, announcements, coordination, and cross-workstream dependencies.
- **Workstream chat:** feature discussion, agent instructions, review findings, failures, and local decisions.

## Roles and leadership

Authorization combines roles, capabilities, and leadership priority rather than scattering role-name checks through application code.

| Role | Default leadership priority |
| --- | ---: |
| Admin | 100 |
| Team Lead | 75 |
| Senior Developer | 50 |
| Developer | 25 |
| Viewer | 0 |

If the Admin is offline, the highest-priority eligible online member may become Session Leader. Leadership grants operational authority, not ownership: it cannot permit self-promotion, owner removal, or organization-level escalation.

## Target system architecture

```text
Conflux Desktop
Tauri 2 + React + TypeScript + Rust
                 |
          REST / WebSocket
                 |
                 v
Collaboration Service - Go
teams, RBAC, presence, chat, workstreams,
CRDT relay, approvals, leadership, terminal control
                 |
                gRPC
         +-------+-------+
         |               |
         v               v
Agent Service - Go   Workspace Service - Java
orchestration,       repository/workstream metadata,
agent runs, LLM,     Git, branches, patches, tests,
workers, tools       execution-host coordination
```

The latency-sensitive text path remains in the Go Collaboration Service. The Java Workspace Service does not sit in the per-keystroke path.

The trusted Rust desktop runtime owns local filesystem access, Git/worktrees, PTYs, workspace state, peer transport, and secure credentials.

## Technology stack

| Area | Technology |
| --- | --- |
| Desktop | Tauri 2 and Rust |
| Frontend | React, TypeScript, Vite |
| Editor | Monaco Editor |
| Collaborative text | Yjs / CRDT |
| Terminal UI | xterm.js |
| Styling | Tailwind CSS and shadcn/ui |
| Collaboration backend | Go |
| Agent backend | Go |
| Workspace backend | Java and Spring Boot |
| Internal RPC | gRPC and Protocol Buffers |
| Realtime transport | WebSockets |
| Database | PostgreSQL |
| Ephemeral state and queues | Redis and Redis Streams |
| Proto tooling | Buf |
| Observability | OpenTelemetry, Prometheus, Grafana, Tempo |
| Local infrastructure | Docker and Docker Compose |
| CI/CD | GitHub Actions |

## Repository status

This repository is being built incrementally toward the target architecture.

```text
conflux/
├── desktop/                  # current Tauri desktop application
├── services/
│   └── identity-service/     # current Spring Boot identity/authentication service
├── docs/
│   └── architecture.md
└── .github/workflows/
```

The architecture ultimately separates collaboration, agent execution, and workspace coordination into dedicated services. The existing identity service is the current foundation for authentication and identity data while that service boundary evolves.

Component documentation:

- [Desktop application](desktop/README.md)
- [Identity service](services/identity-service/README.md)

## Implementation roadmap

1. Two desktop clients collaboratively edit one document with cursor presence, reconnect, and correct local persistence.
2. Teams, roles, capabilities, hierarchy, session leadership, and team chat.
3. Projects and workstreams mapped to branches/worktrees with switching and isolation.
4. Per-workstream shared terminal with execution-host selection and control transfer.
5. Task system and Coder runs that produce candidate patches.
6. Reviewer and Security runs with parallel orchestration.
7. Approvals, stale-patch detection, conflict handling, and safe patch application.
8. Cross-workstream conflict awareness, observability, resilience, load/security testing, and production deployment.

## Current development

### Desktop

See [desktop/README.md](desktop/README.md) for prerequisites, environment configuration, and Tauri development commands.

### Identity service

The identity service currently provides registration, email verification, Argon2id password storage, JWT login/refresh/logout, session revocation, rate limiting, cleanup jobs, and security-event logging.

```bash
cd services/identity-service
./mvnw test
./mvnw spring-boot:run
```

Its local PostgreSQL, SMTP, JWT-key, secret-management, and AWS deployment setup is documented in [services/identity-service/README.md](services/identity-service/README.md).

## Product direction

Conflux enables teams to work on multiple features in parallel, collaborate live inside each workstream, and use task-scoped AI engineering agents without allowing unfinished human or AI work to interfere with unrelated development.
