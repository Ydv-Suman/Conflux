# Conflux Architecture

## Purpose

Conflux is a local-first collaborative development environment. Developers keep local repository copies while realtime document updates move between connected clients. Git remains the durable source-control layer.

This document describes the architecture being built. The current implementation is intentionally smaller than the long-term product design.

## Current system

The first prototype runs entirely inside one Electron process:

```text
┌──────────────────────────────────────────────────────┐
│ Electron main process                                │
│                                                      │
│  Y.Doc ── persistence ── shared-document.yjs         │
│    │                                                 │
│    └── IPC relay ───────┬──────────────────────┐     │
│                         │                      │     │
│                  Renderer A             Renderer B  │
│                  Y.Doc + textarea       Y.Doc + textarea
└──────────────────────────────────────────────────────┘
```

### Responsibilities

| Component | Responsibility |
| --- | --- |
| Electron main process | Own the canonical in-memory `Y.Doc`, persist it locally, relay updates, and create windows |
| Preload bridge | Expose only document state, document updates, and window creation through controlled IPC methods |
| Renderer | Display the editor, maintain a local `Y.Doc`, and apply local or remote updates |
| Yjs | Merge concurrent document changes and encode synchronization updates |

The renderer has no direct Node.js, filesystem, or unrestricted Electron access.

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

The initial server should remain one deployable service with one hardcoded workspace room. Authentication, teams, presence, and service splitting are added only after two independent clients reliably reconnect and converge.

## State ownership

| State | Owner | Durability |
| --- | --- | --- |
| Active document content | Yjs document | Persisted locally and by the collaboration server |
| Cursor, selection, and online presence | Collaboration server | Ephemeral |
| Repository history | Git | Durable |
| Team membership and permissions | Collaboration service database | Durable |
| Chat | Collaboration service database | Durable |
| Terminal session | Selected execution host | Session-scoped |
| AI changes | Candidate patches | Durable until approved or rejected |

CRDT synchronization does not replace Git. Yjs handles live edits; Git records meaningful checkpoints and history.

## Critical editing path

Typing must stay off the database and future service-to-service path:

```text
Local editor → Local Y.Doc → WebSocket relay → Remote Y.Doc → Remote editor
```

The collaboration server may persist updates asynchronously, but it must not call workspace, agent, or authorization services for every keystroke. Authorization occurs when a connection joins a workspace room.

## Security boundary

- Renderers receive narrowly scoped APIs through the preload bridge.
- Filesystem and process access remain in the trusted main process.
- The backend authenticates a connection before allowing it into a workspace room.
- Every room join is authorized against team and workspace membership.
- Repository paths are validated before future file operations.
- AI changes are proposed as patches and never silently applied to the canonical workspace.

## Planned evolution

1. Replace local IPC update relay with one WebSocket collaboration server.
2. Add reconnect synchronization and a two-client convergence test.
3. Add ephemeral cursor, selection, and presence messages.
4. Add authentication, teams, membership, and capability-based authorization.
5. Add repository discovery, file editing, and Git checkpoints.
6. Add shared terminal support with one explicit execution host.
7. Add candidate-patch AI workflows and human approval.

Keep the collaboration server as one service until measured load or clear ownership boundaries justify splitting it. Do not add Redis, PostgreSQL, gRPC, or additional services before the feature requiring them exists.

## Current technology

| Area | Technology |
| --- | --- |
| Desktop runtime | Electron |
| Language | TypeScript |
| Build tooling | Vite and Electron Forge |
| Styling | Tailwind CSS |
| Collaborative document | Yjs |
| Local transport | Electron IPC |
| Network transport | WebSocket, next milestone |

## Milestone exit condition

The networked editor milestone is complete when two separately launched desktop clients can edit one document concurrently, disconnect, reconnect, converge to identical content, and restore that content after restart.
