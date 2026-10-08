# Conflux Architecture

## Purpose

Conflux is a local-first collaborative development environment. Developers keep local repository copies, collaborate in isolated feature workstreams, and use Git as the durable source-control layer.

The product hierarchy is:

```text
Team -> Project -> Workstream -> Task -> Agent Runs
```

This document describes the architecture being built. The current implementation is intentionally smaller than the target system.

## Core collaboration boundary

A project is the team-visible repository. A workstream is the live collaboration and isolation boundary within that project.

```text
Project
├── Authentication workstream -> branch/worktree -> participants and task runs
├── Payments workstream       -> branch/worktree -> participants and task runs
└── Notifications workstream  -> branch/worktree -> participants and task runs
```

Realtime edits, presence, workstream chat, terminals, and task context are scoped to a workstream. Team members may inspect another workstream without receiving its unfinished changes in their active working tree.

Workstream membership is not permanent or exclusive. An authorized project member may join, leave, switch between, or participate in multiple workstreams. A user's active workstream selects the branch, local worktree, collaborative documents, terminal, and feature chat used on that machine.

Each workstream records at least:

- project, branch, base revision, and current revision
- local Git-worktree mapping
- active collaborative documents
- participants and presence
- workstream chat and terminal session
- tasks, agent runs, candidate patches, and approvals
- merge state and overlap with other workstreams

Suggested lifecycle:

```text
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED
                        |               |
                        +-> BLOCKED     +-> CONFLICT
```

## Current implementation

The repository currently contains:

- a Tauri 2 desktop client with authentication and account management
- a Java/Spring Boot identity service
- no implemented collaborative editor, Yjs transport, collaboration service, workstream manager, or agent service yet

The next implementation milestone is therefore a narrow multiplayer-editor proof, not another business service.

## Next milestone: one networked workstream

The first collaboration slice uses one hardcoded project, workstream, room, and text document:

```text
Alice's desktop              Java Collaboration Service              Bob's desktop
Local Y.Doc        <------>  WebFlux WebSocket room       <------>  Local Y.Doc
local file                   update relay + persistence              local file
```

Messages identify the correct boundary even while values are hardcoded:

```text
projectId
workstreamId
documentId
clientId
```

The server initially treats Yjs updates as opaque binary messages. It does not need to interpret or merge document content. Authentication, multiple workstreams, presence, terminals, agents, Redis, and cross-service RPC remain outside this milestone.

## Target service boundaries

The target backend uses Java while preserving independently scalable responsibility boundaries:

| Service | Runtime | Responsibility |
| --- | --- | --- |
| Realtime Collaboration | Java, Spring WebFlux, Reactor Netty | Workstream WebSockets, Yjs relay, presence, cursors, reconnect, and realtime fanout |
| Identity and Team | Java, Spring Boot | Authentication, teams, invitations, membership, capabilities, leadership, and team chat |
| Workspace | Java, Spring Boot | Projects, workstreams, repository metadata, Git policy, checkpoints, overlap detection, patches, approvals, and merge lifecycle |
| Agent | Python, FastAPI | Agent profiles, task-scoped runs, orchestration, tools, review pipeline, event streaming, and usage limits |

Service boundaries follow data ownership, latency, and scaling requirements rather than programming language. Realtime Collaboration uses non-blocking WebSockets. The Java transactional services use ordinary Spring request handling. The Python Agent Service uses asynchronous I/O for model calls, tool coordination, and event streaming.

Using one backend language does not justify combining these responsibilities into one application. In particular, database-heavy work and agent execution must remain outside the realtime typing path.

## Local and remote responsibilities

The trusted Tauri/Rust runtime owns operations on the developer's machine:

- filesystem access and repository path validation
- Git commands, branches, and local worktrees
- PTY creation and process execution
- secure credential storage
- persistence of accepted collaborative content to local files

Remote services own shared metadata, authorization, coordination, and event relay. A remote Workspace service records worktree mappings and policy but does not directly manipulate a developer's filesystem.

## State ownership and scope

| State | Scope | Owner | Durability |
| --- | --- | --- | --- |
| Users, membership, capabilities | Team | Identity and Team | Durable |
| General chat | Team or project | Identity and Team | Durable |
| Repository identity and Git history | Project | Git plus Workspace metadata | Durable |
| Branch, base revision, merge state | Workstream | Workspace | Durable |
| Active document content | Workstream and document | Yjs; persisted locally and by Realtime Collaboration | Durable |
| Cursor, selection, typing, online presence | Workstream | Realtime Collaboration | Ephemeral |
| Feature chat | Workstream | Workspace or collaboration persistence boundary | Durable |
| Terminal output and controller | Workstream | One local execution host plus Realtime Collaboration | Session-scoped |
| Task definition and conversation | Task | Agent | Durable |
| Coder, Reviewer, and Security executions | Task | Agent | Durable events |
| Candidate patches and approvals | Task and workstream | Workspace | Durable until resolved |

## Agent execution model

Coder, Reviewer, and Security are profiles or templates, not permanently running company-wide bots.

```text
AgentProfile
├── role and model
├── system instructions
├── available tools
└── permissions

Task #101 in Authentication
├── CoderRun #501
├── ReviewerRun #502
└── SecurityRun #503
```

Every run receives task and workstream context: project, branch, base and current revisions, relevant documents, participants, task conversation, and current candidate patch. Runs from unrelated workstreams do not share conversational or repository context.

Agent output is always a candidate patch. Before application, Workspace validates its paths, base revision, current workstream revision, policy, review evidence, and test evidence. Human approval is required before it enters the collaborative workstream.

## Workstream isolation and merge

Each workstream maps to a Git branch and may use a dedicated local Git worktree:

```text
project checkout
└── .conflux/worktrees
    ├── auth-refresh
    ├── payment-webhook
    └── notifications
```

The exact storage location is implementation-defined and must not require `.conflux` to be committed. Switching workstreams changes the active worktree instead of rewriting one shared directory between incompatible states.

Workspace compares changed paths, and later changed line ranges, across active workstreams. It reports potential overlap early but leaves conflict resolution to Git and explicit human review.

When a workstream merges, every project member can see that the project base has advanced. Other workstreams are marked behind, but their files are not changed automatically. Their participants must explicitly review and update or rebase the workstream; workstreams are never silently rebased or merged.

## Critical editing path

Typing stays off databases and service-to-service calls:

```text
Local editor -> Local Y.Doc -> Workstream WebSocket room -> Remote Y.Doc -> Remote editor
```

Realtime Collaboration may persist updates asynchronously. Identity authorization happens when a client joins a workstream room, not for every keystroke. Workspace and Agent are not called for document updates.

The collaboration service enforces bounded message sizes, per-client outbound queues, room capacity, join and idle timeouts, and slow-client behavior.

## Terminal and chat scopes

Each active workstream has its own logical shared terminal and execution context. One explicitly selected local machine hosts its PTY. Authorized participants may observe output, while exactly one controller supplies input at a time.

Team or project chat is available to every project member, regardless of active workstream, and is used for broad coordination. Workstream chat contains feature-specific discussion and task mentions. Agent mentions in a workstream create tasks whose runs are scoped to that workstream.

## Security boundary

- Renderers receive narrowly scoped Tauri commands and events.
- Filesystem, Git, and process access remain in the trusted Rust runtime.
- Identity authenticates users and owns team capabilities.
- Realtime Collaboration validates a token and room capability when a client joins.
- Repository and worktree paths are validated before every local operation.
- AI runs receive allowlisted tools and cannot silently modify canonical files.
- Candidate patches are versioned, reviewed, tested, and explicitly approved.
- Merge and workstream-update operations are auditable and never automatic on conflict.

## Planned evolution

1. Prove one hardcoded workstream with two desktop clients, Yjs, and a Java WebFlux WebSocket relay.
2. Add reconnect synchronization, local persistence, and one two-client convergence test.
3. Add project/workstream identifiers, ephemeral cursor and presence messages, and bounded room behavior.
4. Add project and workstream creation backed by Git branches and local worktrees.
5. Connect the existing Identity and Team service for authenticated room authorization and capabilities.
6. Add per-workstream chat, overlap detection, update-from-base, and merge lifecycle.
7. Add a per-workstream shared terminal with one explicit execution host.
8. Add task-scoped Agent runs and the candidate-patch approval workflow.

Build infrastructure only when its milestone requires it. Do not add Redis, distributed room ownership, service discovery, or cross-service RPC to the first convergence proof.

## Technology

| Area | Technology |
| --- | --- |
| Desktop runtime | Tauri 2 |
| Trusted local runtime | Rust |
| Frontend | TypeScript and React |
| Code editor | Monaco Editor |
| Collaborative document | Yjs |
| Realtime transport | WebSocket |
| Realtime backend | Java, Spring WebFlux, Reactor Netty |
| Identity and workspace backends | Java and Spring Boot |
| Agent backend | Python and FastAPI |
| Initial agent runtime | OpenAI Agents SDK for Python |
| Durable business data | PostgreSQL when required |
| Repository history and isolation | Git branches and worktrees |

## Multiplayer milestone exit condition

The first networked-editor milestone is complete when two separately launched desktop clients join the same workstream, concurrently edit one document, disconnect, reconnect, converge to identical content, and restore that content after restart.
