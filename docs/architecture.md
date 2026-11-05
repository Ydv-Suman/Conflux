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

A workstream represents a durable feature, bug fix, or other shared initiative rather than a temporary coding session. Every active workstream owns one canonical branch, and only one non-archived workstream may own a given project and branch pair. Tasks, participant sessions, and agent runs live inside the workstream instead of creating more workstreams. The complete user and Git workflow is defined in [Workstream, Branch, and Agent Workflow](workstream-workflow.md).

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

- a Tauri 2 + React + TypeScript desktop client with authentication, teams, projects, and workstream management
- Java/Spring Boot identity and workspace services
- an authenticated Java/Spring WebFlux collaboration service that durably journals opaque binary updates by project, workstream, and document before acknowledging and broadcasting them
- a Monaco editor bound to a Yjs document and connected to the collaboration-service relay
- local repository inspection, protected text-file reads and writes, and per-workstream Git worktree creation
- desktop SQLite document recovery, pending-update retries, automatic reconnect, and automated recovery/convergence checks
- team-wide online presence with an admin/team-lead roster, plus file-tree synchronization
- a document activity endpoint exposing authenticated update submitters, timestamps, and sequences; this is not original edit attribution
- no verified authorship ledger, contribution dashboard, live remote cursors, shared Git checkpoint implementation, or agent service yet

The manual two-user native desktop checks passed as reported by the user on 2026-11-05. Reliable contribution attribution and file history are the next milestone, before live cursors and shared Git checkpoints.

## Next milestone: attributable shared editing

Start with two authenticated users editing one document in the same project and workstream:

```text
Alice's desktop              Java Collaboration Service              Bob's desktop
Local Y.Doc        <------>  WebFlux WebSocket room       <------>  Local Y.Doc
local file + SQLite          durable updates + provenance            local file + SQLite
```

Scope attribution to:

```text
teamId
projectId
workstreamId
documentId
stable edit identity and document version
authenticated actor and provenance status
```

The current server treats Yjs updates as opaque binary messages. An authenticated sender or client-supplied Yjs client ID cannot establish the authorship of every operation in a snapshot. Define and test the provenance protocol and its trust boundary before claiming original authorship. The wire format, storage schema, offline identity binding, and CRDT validation strategy remain to be designed; this document specifies requirements, not an implemented protocol.

First acceptance: Alice and Bob make concurrent and offline edits, Bob reconnects, and both clients and the service restart. File history reconstructs the accepted versions and shows attributable changes with before/after diffs. Bob's reconnect cannot claim Alice's edits, replay cannot inflate contribution counts, and unsupported authorship stays unknown. Verify the report permissions below before exposing member analytics.

## Target service boundaries

The target backend uses Java while preserving independently scalable responsibility boundaries:

| Service | Runtime | Responsibility |
| --- | --- | --- |
| Realtime Collaboration | Java, Spring WebFlux, Reactor Netty | Workstream WebSockets, Yjs relay, durable edit provenance, presence, cursors, reconnect, and realtime fanout |
| Identity and Team | Java, Spring Boot | Authentication, teams, invitations, membership, capabilities, leadership, and team chat |
| Workspace | Java, Spring Boot | Projects, workstreams, repository metadata, explicit ownership, contribution reports and correction audit, Git policy, checkpoints, overlap detection, patches, approvals, and merge lifecycle |
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
| Edit provenance and document version references (planned) | Project, workstream, and document | Realtime Collaboration | Durable; preserved through replay and compaction |
| Task/module ownership and attribution corrections (planned) | Team, project, workstream, and task/path | Workspace | Durable, audited |
| Contribution report projections (planned) | Authorized team/project/workstream and member | Workspace | Rebuildable from durable evidence |
| Cursor, selection, typing | Workstream and document | Realtime Collaboration | Ephemeral |
| Online count and restricted roster | Team | Realtime Collaboration | Ephemeral |
| Feature chat | Workstream | Workspace or collaboration persistence boundary | Durable |
| Terminal output and controller | Workstream | One local execution host plus Realtime Collaboration | Session-scoped |
| Task definition and conversation | Task | Agent | Durable |
| Coder, Reviewer, and Security executions | Task | Agent | Durable events |
| Candidate patches and approvals | Task and workstream | Workspace | Durable until resolved |

## Contribution attribution and ownership (planned)

### Evidence and identity

Keep original contributor, authenticated update submitter, explicitly assigned task/module owner, checkpoint creator, and reviewer as separate identities. Task/module ownership includes assignment history; it is not inferred from editing volume or the last edit. Branch ownership elsewhere in this document identifies a workstream, not a person's contribution.

The current journal and activity API prove only which authenticated account submitted an update and when the server accepted it. Snapshots may contain multiple contributors' operations. Existing records must not be relabeled as verified original authorship. Server receipt time must remain distinct from any claimed offline edit time.

The planned attribution contract must:

- Bind new attributable edits to authenticated provenance and stable edit identities; never trust arbitrary author IDs or a raw Yjs client ID as proof. Specify how offline edits retain their originating identity, including account changes on one device.
- Preserve origin and version references through concurrency, offline recovery, retries, snapshots, reconnects, restarts, and future compaction. Record content and its provenance consistently; failed or partial writes cannot produce a success claim with missing evidence.
- Deduplicate logical edits across replay and differently encoded snapshots, not just identical network payloads. Undo/redo and shared edits need explicit attribution rules; they cannot silently multiply credit.
- Track file creation, deletion, and rename using stable document identity. Define coverage for imported, binary, generated, and externally edited files; unsupported attribution remains unknown or unverified.
- Reconstruct before/after content at defined document versions. A line number alone is not a stable edit identity. Link future checkpoints to the exact captured document/file-tree versions and their provenance without crediting the publisher for everyone else's edits.
- Preserve multiple contributors where supported. Future agent changes identify the agent run and the human approver separately; neither silently becomes the sole human author.
- Allow members to request corrections. Authorized admins/team leads resolve them with reason, actor, time, and supporting evidence, appending an audited correction without erasing the original assertion.

### Access and presentation

All views below are planned. The existing activity endpoint uses document editing authorization and exposes submitter metadata; it does not implement these reporting capabilities.

| View or action | Authorization requirement |
| --- | --- |
| Team-wide contribution dashboards, other-member analytics, comparisons, ownership reports, and correction resolution | Centrally managed reporting/management capabilities limited to admins and team leads, plus access to the requested team/project/workstream |
| Own contribution records and submission/status of correction requests | Authenticated subject's own records within authorized scope; a supplied member ID cannot broaden access |
| Ordinary shared file history and debugging diffs | Document history access; omit restricted analytics and management annotations |

Identity owns capability policy; Workspace enforces report and correction access; Collaboration enforces provenance/history access at its boundary. Roles are not scattered through frontend or service business logic. A session leader is not granted reporting authority by that operational role alone. Admin or lead status in one team grants no access to another team's reports or inaccessible workstreams.

Authorize every report, drill-down, correction, and any future export on the backend. Revalidate long-lived subscriptions, fail closed when authorization cannot be established, and invalidate restricted frontend views/caches after role or membership revocation. Define and test a bounded revocation interval before release. Hiding controls is not authorization; removing access cannot retract records already legitimately downloaded.

The desktop starts with **Workstream → Changes & History → File history**, displaying attributable diffs and explicit unknowns. Admins/leads later receive **Contributions**, filtered by member and date range, with links to source evidence. Members receive their own records and correction requests. Checkpoint comparisons and test-result links follow checkpoint implementation; task, review, and agent measures depend on those workflows.

### Meaning of contribution measures

Reports may describe accepted work, attributed code changes, reviews, tests, confirmed regression investigations, and documented pairing, mentoring, or unblocking. Each measure specifies scope, time window, definition, provenance coverage, and shared-credit rules. Missing evidence is not zero contribution. Generated/imported content and retry traffic must not inflate human contribution measures.

There is no universal contribution percentage, automated performance score, or employment recommendation. Keystrokes, online time, lines changed, and commit counts cannot establish overall value. Reports support human judgment alongside task difficulty, role expectations, opportunities, shared work, and the member's explanation. Suspected regressions require reproduction and evidence against exact versions before being recorded as confirmed; last-editor status is not proof of causation.

Derived reports and aggregation stay outside the realtime editing path. Attribution is a durable data-integrity requirement; presence and cursors remain ephemeral and are not contribution evidence.

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

Each run executes in an isolated temporary worktree or remote environment created at an exact workstream revision. It never switches or edits a human participant's managed worktree. Temporary agent refs belong to the task run and do not create visible workstreams.

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

Branch selection is a join-or-create operation. Selecting a branch already owned by an active workstream opens that workstream; selecting an available local or remote branch offers lightweight workstream creation. Workspace enforces unique active ownership of the `(project, canonical branch)` pair.

Managed worktrees remain bound to their workstream branch. If an external Git command changes `HEAD`, the desktop pauses collaboration until the user opens the matching workstream or restores the expected branch.

Workspace compares changed paths, and later changed line ranges, across active workstreams. It reports potential overlap early but leaves conflict resolution to Git and explicit human review.

When a workstream merges, every project member can see that the project base has advanced. Other active workstreams are marked behind, but their files are not changed automatically. Their participants must explicitly review and update their workstream.

Updating an actively shared workstream merges the project base branch by default because rebasing rewrites shared commit identifiers. Rebase is an explicit coordinated operation that requires checkpointed edits, a temporary write freeze, a recoverable pre-rebase revision, and conflict handling. Workstreams are never silently rebased, merged, or reset.

## Critical editing path

Typing stays off databases and service-to-service calls:

```text
Local editor -> Local Y.Doc -> Workstream WebSocket room -> Remote Y.Doc -> Remote editor
```

The local editor updates immediately. The current relay persists accepted updates before acknowledgement and broadcast; planned provenance must preserve that durability boundary. Identity authorization happens on join and is rechecked periodically, not for every keystroke. Workspace and Agent are not called for individual document updates, and contribution-report aggregation stays off this path.

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
- Planned contribution and ownership reports require backend capabilities limited to admins/team leads within the requested scope; self-history and shared debugging history use separate access rules.
- Planned attribution corrections are audited, and report access is revoked when role, membership, or resource access is lost.

## Planned evolution

1. Define the edit-attribution protocol, storage consistency, trust boundary, coverage, and access contract above.
2. Implement and validate one-file attributable history, backend access checks, self-records, and audited correction handling. Exercise concurrency, offline work, replay, restart, spoofing attempts, and revocation before reporting contribution totals.
3. Add named remote cursors and selections, scoped to the active file and separate from durable attribution and team presence.
4. Add the Git changes panel and coordinated shared checkpoints, preserving provenance and separating contributors from checkpoint creators and reviewers.
5. Extend workstream branch/update/merge workflows, task ownership, review evidence, and chat as needed. Add evidence-backed contribution reporting only as its source workflows become available.
6. Add a local terminal, then per-workstream shared output and input control with one explicit execution host.
7. Add task-scoped Agent runs in isolated worktrees and the candidate-patch approval workflow, retaining agent and human-approval provenance.

Build infrastructure only when its milestone requires it. This attribution plan does not require a new service; start within the existing Collaboration, Identity, and Workspace boundaries.

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
