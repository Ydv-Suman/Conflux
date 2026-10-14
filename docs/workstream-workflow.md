# Workstream, Branch, and Agent Workflow

## Purpose

This document defines how Conflux maps shared team work onto Git branches,
local worktrees, tasks, and isolated AI agent runs. It covers creating, joining,
switching, updating, and completing workstreams.

## Core model

A workstream represents a durable collaborative initiative, such as a feature,
bug fix, or refactor. It is not a temporary coding session and is not created
for every AI task.

```text
Team
└── Project
    └── Workstream: OAuth refresh
        ├── Canonical branch: feature/oauth-refresh
        ├── Human participants: Alice, Bob
        ├── Tasks
        │   ├── Implement refresh endpoint
        │   └── Add integration tests
        ├── Agent runs in isolated worktrees
        └── One local worktree per participating device
```

The required invariants are:

1. Every active workstream owns exactly one canonical Git branch.
2. Only one non-archived workstream may own a `(project, canonical branch)` pair.
3. A device uses a separate local worktree for each joined workstream.
4. Tasks, user sessions, and agent runs do not create additional workstreams.
5. An agent run never edits the canonical workstream worktree directly.
6. Applying a candidate change validates it against the current revision.

The Workspace Service enforces branch ownership. UI checks alone are
insufficient because two users may create workstreams concurrently.

## Create or join from a branch

Users can start from either the workstream list or branch list. Conflux resolves
whether the branch already belongs to shared work.

```text
User selects or enters a branch
            │
            ├── Active workstream owns it ──> Join or open that workstream
            ├── Archived workstream owns it ─> Restore or create new work
            └── No workstream owns it ───────> Create a lightweight workstream
```

### Create-workstream form

The form contains:

- a human-readable title
- **Create a new branch** or **Use an existing branch**
- a searchable local and remote branch selector
- a starting point, defaulting to the project's configured base branch
- branch availability and ahead/behind information

Before listing branches, Conflux fetches the configured remote when online.
The branch selector groups active-workstream branches, available local
branches, available remote-tracking branches, archived branches, and the
protected base branch.

Selecting an owned branch opens **Join workstream**. Creating from a remote-only
branch creates a local tracking branch in the new worktree. Conflux does not
force Git to check out a branch already attached to another worktree on the
same device.

The title may be derived from the branch name and edited later. For example,
`feature/oauth-refresh` becomes `OAuth refresh`.

### Duplicate prevention

The Workspace Service rejects a second active workstream for the same project
and branch. A similar title or linked task produces a warning that recommends
joining existing work. Separate work remains possible on a distinct branch.

## Fast workstream switching

Switching workstreams activates another local worktree; it does not run
`git switch` inside the current managed worktree. Keeping worktrees alive makes
switching fast and preserves uncommitted work in each context.

The searchable, keyboard-accessible switcher prioritizes:

1. current and recent workstreams
2. work assigned to the user
3. workstreams with active teammates
4. work needing review
5. all remaining active workstreams
6. branches without workstreams

Selecting an unowned branch opens lightweight workstream creation. Selecting
an owned branch joins or opens its workstream automatically.

If an external Git command changes `HEAD` in a managed worktree, Conflux pauses
collaboration. It offers to open the matching workstream or restore the expected
branch. It never silently sends edits under the old workstream identity.

## Workstream lifecycle

```text
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED -> ARCHIVED
                        |               |
                        +-> BLOCKED     +-> CONFLICT
```

Workstreams normally live for days or weeks. Tasks live for minutes or days,
and participant sessions for minutes or hours. Returning to the same initiative
creates a task or session inside the existing workstream. Archived workstreams
are hidden by default but remain searchable and auditable.

## Updating from the project base

The project records a base branch, normally `origin/main`. Each workstream
shows its ahead/behind status relative to that base.

### Default: merge the base branch

Active shared workstreams update from the base with a merge by default. Rebase
rewrites commit identifiers and is unsafe as an automatic operation while
several people or agents share the branch.

The **Update from main** operation:

1. fetches the remote
2. verifies permission and acquires a short workstream update lease
3. checkpoints collaborative documents and records the current revision
4. merges the latest base revision into the workstream branch
5. enters `CONFLICT` if Git cannot complete the merge
6. runs configured validation after a successful merge
7. publishes the new revision and releases the lease
8. notifies participants that their local replica is behind

Conflux never silently resets another participant's dirty worktree. Each device
explicitly reconciles its local state with the published revision.

### Controlled rebase

Rebase is an advanced coordinated operation requiring:

- caller permission
- checkpointed collaborative edits
- no active writers, or acknowledgement of a temporary freeze
- a branch policy that permits rewritten history
- a recoverable pre-rebase revision

Conflicts expose explicit **Continue rebase** and **Abort rebase** actions.
Conflux never rebases an active workstream silently. Teams may rebase or squash
during final integration after collaboration is frozen; merge remains the
safer default during active work.

## AI agent execution

Agents receive workstream context without switching a human's branch or
operating the desktop UI.

```text
Task created in workstream
          │
          ▼
Snapshot current revision
          │
          ▼
Create isolated agent worktree/environment
          │
          ▼
Agent edits, tests, and produces commits or a patch
          │
          ▼
Validate candidate against latest workstream revision
     ┌────┴────┐
     │         │
   Clean     Stale or conflicting
     │         │
     ▼         ▼
 Review     Re-run, rebase, or resolve
     │
     ▼
Apply after approval
```

Every `AgentRun` records:

- project, workstream, and task identifiers
- base and current revisions
- isolated worktree or execution-environment identity
- allowed tools, credentials, and network policy
- produced patch or commits
- test, review, and security evidence

Temporary agent refs use a namespace such as
`refs/conflux/agents/<task-id>/<run-id>`. If ordinary branches are required,
they use `conflux-agent/<task-id>/<run-id>`. They do not appear as normal
workstreams and are deleted or archived after resolution.

If the workstream advances while an agent runs, Workspace tests the candidate
against the new revision. A clean candidate is revalidated; a stale or
conflicting candidate is never applied automatically.

### External agent adapters

External local and cloud agents do not need native knowledge of workstreams.
An adapter provides an isolated path or repository reference, exact base
revision, task context, scoped policy, and a required result contract. Conflux
imports the resulting patch, commit, or pull request as a candidate. Human
approval and Workspace validation remain mandatory before it enters the
canonical workstream.

## Implementation order

1. Enforce unique active `(project, canonical branch)` ownership.
2. List local and fetched remote branches with availability metadata.
3. Implement branch-driven join-or-create.
4. Add the recent and assigned workstream switcher.
5. Detect external `HEAD` changes in managed worktrees.
6. Add ahead/behind status and merge-based **Update from main**.
7. Add coordinated conflict handling and optional rebase.
8. Run AI tasks in isolated worktrees and import candidate changes.

This workflow precedes expanded terminal or agent features because those
features depend on stable workstream and revision identity.
