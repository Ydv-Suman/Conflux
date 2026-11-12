# Git working structure

Git provides reviewed project checkpoints while live collaboration continues
through Yjs. This document describes the proposed workflow. Repository inspection,
local worktree creation, and the read-only Changes panel already exist; coordinated shared Git checkpoints
and reconciliation still need implementation.

## Branch and worktree structure

```text
Project repository
│
├── main                         ← reviewed, integrated code
│
├── Workstream: Authentication
│   └── feature/authentication
│       ├── Alice's local worktree
│       ├── Bob's local worktree
│       └── Shared Git checkpoints
│
└── Workstream: Payments
    └── feature/payments
        ├── Alice's separate local worktree
        └── Shared Git checkpoints
```

One workstream owns one canonical branch. Teammates collaborate in that
workstream through separate local worktrees on their devices. Switching
workstreams activates another worktree and preserves unfinished work.

Only one non-archived workstream may own a project/branch pair. Conflux must
respect Git's restriction against checking out the same branch in multiple
worktrees within one local repository.

## Normal workflow

### 1. Connect or download the repository

Conflux records the remote repository, configured base branch, and starting
commit. The base branch is commonly `main`, but must follow project configuration.

### 2. Open a workstream

Create or join its branch. Each participating device prepares a local worktree
at the recorded shared revision. A missing revision must be fetched before the
worktree can be opened.

### 3. Edit together

Yjs synchronizes document changes within the workstream. Local working files and
SQLite recovery are updated. Closing a changed file creates a file-history
version; Git commits remain explicit actions.

### 4. Review the Changes panel

Show added, modified, deleted, and renamed files with before/after diffs. Separate
synchronized shared changes from local changes that have not entered
collaboration. The initial shared-checkpoint implementation should commit the
reviewed shared changes together rather than introduce partial staging.

Git ignore rules must be respected, and unrelated local files or previously
staged changes must not enter a shared checkpoint accidentally. If the snapshot
contains unsupported file content, report it rather than silently omitting it.

### 5. Create a shared Git checkpoint

An authorized user enters a commit message. Workspace grants one desktop a short
operation lease so two users cannot publish competing checkpoints through
Conflux. The operation is tied to an expected parent revision and unique request
ID; an expired or superseded executor must not advance shared state.

Collaboration captures a consistent file-tree and document revision boundary.
The executing desktop materializes that exact snapshot in an isolated temporary
worktree, creates the commit, and pushes it to the workstream branch. It must not
commit whichever files happen to be on the executing desktop's disk.

The capture protocol must define a consistent boundary across all included
documents and the file tree. Edits accepted after that boundary remain pending
for a later checkpoint. Shared checkpoint creation requires connectivity;
offline editing and local recovery continue independently.

### 6. Publish the checkpoint and reconcile replicas

Record the commit hash, parent revision, captured document/tree boundaries,
creator, and operation ID. Advance the shared revision only after publication
succeeds and the checkpoint's expected revision and snapshot association have
been validated.

Git push and the Workspace database update are separate operations. If a push
succeeds but the response or metadata update fails, retries must discover and
finish recording the existing commit rather than create another one. The
implementation must define how remote objects and snapshot contents are verified;
a client-supplied commit hash alone is not proof of a correct checkpoint.

Other desktops fetch the published commit and reconcile their worktrees while
preserving newer edits and existing local work. Conflux must not reset another
participant's dirty worktree or reinsert already synchronized content into Yjs.

A workstream lease coordinates Conflux clients; it does not lock external Git
tools. A moved remote branch or unexpected local `HEAD` must stop the operation
for explicit reconciliation. Do not force-push over another revision.

### 7. Review and merge into the project base branch

When a feature is ready, open a pull request or follow the project's configured
review process. Merge after approval and required checks, then record the actual
resulting revision in Workspace. Other workstreams can explicitly update from
the base branch.

Merge is the default for updating active shared workstreams from the base.
Rebase and history rewriting require separate coordinated handling. Conflicts
must expose explicit resolution and abort actions; no silent resets or automatic
overwrites of shared work.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| Desktop UI | Changes list, diffs, commit message, progress, and conflicts |
| Tauri/Rust | Local Git execution, isolated worktrees, Git credentials, fetch, and push |
| Collaboration Service | Consistent shared document/tree snapshots and revision boundaries |
| Workspace Service | Permissions, operation leases, checkpoint metadata, and merge lifecycle |
| Git remote | Store commits and branches and enforce remote branch protections |

No additional service is required for this first implementation. Git execution
runs on an authorized desktop. A future centrally hosted execution environment
would require a separate deployment and execution design.

## Recovery, file history, and Git are separate

| Record | Created when | Scope |
| --- | --- | --- |
| Local recovery | Work is persisted locally | One device |
| File-history version | A changed file is closed | One shared file |
| Git checkpoint | A user explicitly commits reviewed shared changes | Multiple files in a workstream |

The commit creator and contributors remain separate. Alice creating a checkpoint
must not make Bob's document edits appear to be Alice's contributions. Retain
the connection between the checkpoint snapshot and existing document provenance.
Git author/committer fields alone do not establish individual edit ownership.

Git checkpoints do not replace file-history versions, and closing an editor tab
does not automatically create a Git commit.

## Implementation order

1. **Implemented:** read-only Changes panel with local Git status and HEAD-to-disk
   diffs, staged/unstaged labels, Git ignore rules, and explicit unsupported-file
   errors. Native visual acceptance remains pending.
2. Consistent shared snapshot capture with document and file-tree boundaries.
3. Coordinated checkpoint execution, commit/push, and retry-safe publication.
4. Teammate reconciliation that preserves edits newer than the checkpoint.
5. Review, merge, base-branch updates, and conflict handling.

The read-only Changes panel is implemented. Shared snapshot execution and
reconciliation are the main correctness work before enabling shared commits.
Later AI agents can propose changes in isolated worktrees and reuse the same
review and checkpoint foundation.

## Related documents

- [Workstream, Branch, and Agent Workflow](workstream-workflow.md)
- [How file history is stored today](file-history-storage.md)
- [Conflux Architecture](architecture.md)
