# Conflux Architecture

## Purpose

Conflux is a local-first collaborative development environment. Developers keep local repository copies while realtime document updates move between connected clients. Git remains the durable source-control layer.

This document describes the architecture being built. The current implementation is intentionally smaller than the long-term product design.

## Current system

The first prototype runs entirely inside one Tauri application:

```text
┌──────────────────────────────────────────────────────┐
│ Rust core                                            │
│                                                      │
│  Yjs update log ── persistence ── app data directory │
│    │                                                 │
│    └── Tauri events ────┬──────────────────────┐     │
│                         │                      │     │
│                  Renderer A             Renderer B  │
│                  Y.Doc + textarea       Y.Doc + textarea
└──────────────────────────────────────────────────────┘
```

### Responsibilities

| Component | Responsibility |
| --- | --- |
| Rust core | Persist Yjs updates, emit updates to open windows, and create windows |
| Tauri command boundary | Expose only document state, document updates, and window creation |
| Renderer | Display the editor, maintain a local `Y.Doc`, and apply local or remote updates |
| Yjs | Merge concurrent document changes and encode synchronization updates |

The renderer has no direct Node.js or unrestricted filesystem access.

## Next system: networked collaboration

IPC is a local transport used to prove document convergence. The next milestone replaces that relay with a WebSocket connection:

```text
┌──────────────────┐       WebSocket       ┌──────────────────────┐
│ Alice's desktop  │◄─────────────────────►│ Collaboration server │
│ Local Y.Doc      │                       │ Workspace rooms      │
└──────────────────┘                       │ Yjs update relay     │
                                           │ Document persistence │
┌──────────────────┐       WebSocket       │ Reconnect sync       │
│ Bob's desktop    │◄─────────────────────►│                      │
│ Local Y.Doc      │                       └──────────────────────┘
└──────────────────┘
```

The initial server should remain one deployable service with one hardcoded workspace room. Authentication, teams, and the remaining services are added only after two independent clients reliably reconnect and converge.

## Target service boundaries

The target backend has four services split evenly across Go and Java by workload type:

| Service | Language | Responsibility |
| --- | --- | --- |
| Realtime Collaboration | Go | WebSockets, Yjs relay, rooms, presence, cursors, and reconnect |
| Agent | Go | AI orchestration, tools, review pipeline, event streaming, and usage limits |
| Identity and Team | Java / Spring Boot | Authentication, teams, invitations, RBAC, leadership, and chat |
| Workspace | Java / Spring Boot | Repository metadata, Git, checkpoints, patches, approvals, and terminal policy |

Go owns connection-heavy and concurrent workloads. Java owns durable business rules and transactional state. The service boundary must keep the realtime typing path independent from database-heavy operations.

## State ownership

| State | Owner | Durability |
| --- | --- | --- |
| Active document content | Yjs document | Persisted locally and by Realtime Collaboration |
| Cursor, selection, and online presence | Realtime Collaboration | Ephemeral |
| Repository history | Git | Durable |
| Team membership, permissions, and chat | Identity and Team | Durable |
| Repository and terminal policy | Workspace | Durable or session-scoped as appropriate |
| AI task execution | Agent | Durable task events |
| Candidate patches and approvals | Workspace | Durable until approved or rejected |

CRDT synchronization does not replace Git. Yjs handles live edits; Git records meaningful checkpoints and history.

## Critical editing path

Typing must stay off the database and future service-to-service path:

```text
Local editor → Local Y.Doc → WebSocket relay → Remote Y.Doc → Remote editor
```

Realtime Collaboration may persist updates asynchronously, but it must not call Workspace, Agent, or Identity for every keystroke. Identity authorization occurs when a connection joins a workspace room.

## Security boundary

- Renderers receive narrowly scoped Tauri commands and events.
- Filesystem and process access remain in the trusted Rust core.
- Identity authenticates users and owns team capabilities.
- Realtime Collaboration authorizes every room join before accepting document updates.
- Repository paths are validated before future file operations.
- AI changes are proposed as patches and never silently applied to the canonical workspace.

## Planned evolution

1. Replace local IPC update relay with one WebSocket collaboration server.
2. Add reconnect synchronization and a two-client convergence test.
3. Add ephemeral cursor, selection, and presence messages to Realtime Collaboration.
4. Add the Java Identity and Team Service for authentication and capability-based authorization.
5. Add the Java Workspace Service for repository discovery, file editing, and Git checkpoints.
6. Add shared terminal support with one explicit execution host.
7. Add the Go Agent Service and candidate-patch approval workflow.

Build each service only when its milestone begins. Do not add Redis, PostgreSQL, gRPC, or cross-service infrastructure before a feature requires it.

## Current technology

| Area | Technology |
| --- | --- |
| Desktop runtime | Tauri 2 |
| Native runtime | Rust |
| Frontend language | TypeScript |
| Build tooling | Vite and Tauri CLI |
| Styling | Tailwind CSS |
| Collaborative document | Yjs |
| Local transport | Tauri commands and events |
| Network transport | WebSocket, next milestone |

## Target backend technology

| Service | Technology |
| --- | --- |
| Realtime Collaboration | Go |
| Agent | Go |
| Identity and Team | Java with Spring Boot |
| Workspace | Java with Spring Boot |

## Milestone exit condition

The networked editor milestone is complete when two separately launched desktop clients can edit one document concurrently, disconnect, reconnect, converge to identical content, and restore that content after restart.
