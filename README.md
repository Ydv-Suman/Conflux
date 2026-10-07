# Conflux

> A local-first multiplayer development environment where developers and task-scoped AI agents collaborate within isolated feature workstreams.

Conflux is a collaborative desktop IDE designed for software teams working with AI.

Instead of giving every developer an isolated AI coding assistant, Conflux creates a shared project with collaborative **workstreams** where team members and specialized AI agents work on independent features without disrupting one another.

Developers can edit code together in real time, see each other's cursors and changes, communicate through team and workstream chat, use a per-workstream shared terminal, assign tasks to shared AI role profiles, review AI-generated changes, and approve consequential actions before they enter the canonical workspace.

The source repository remains on developers' machines. Conflux does not require the repository itself to be hosted by Conflux.

---

# Product Vision

Traditional AI coding tools generally follow this model:

```text
Developer A → AI Assistant A → Local Repository A

Developer B → AI Assistant B → Local Repository B

Developer C → AI Assistant C → Local Repository C
```

Each developer works independently with their own AI context.

Conflux uses a different model:

```text
                 CONFLUX WORKSPACE

       Alice          Bob          Charlie
         │             │              │
         └─────────────┼──────────────┘
                       │
                       ▼
              Shared Workspace
                       │
        ┌──────────────┼───────────────┐
        │              │               │
        ▼              ▼               ▼
      Code          Terminal          Chat
        │
        ▼
                Shared AI Team
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        Coder       Reviewer      Security
        Agent         Agent         Agent
```

Humans and AI agents participate in the same logical development workspace.

Conflux synchronizes collaboration and workspace state while Git remains the durable source-control system.

---

# Updated Workstream Model

Conflux isolates parallel feature development while preserving team-wide visibility.

```text
Team -> Project -> Workstream -> Task -> Agent Runs
```

A workstream behaves like a collaborative feature branch. It owns a branch and base revision, active collaborative documents, participants, task and agent context, shared chat and terminal context, and a merge lifecycle.

```text
Project
├── Authentication workstream -> live collaboration -> Git branch/worktree
├── Payments workstream       -> live collaboration -> Git branch/worktree
└── Notifications workstream  -> live collaboration -> Git branch/worktree
```

Realtime CRDT synchronization occurs between collaborators in the same workstream. Other team members retain visibility into its status without automatically receiving every unfinished edit in their active working tree.

Suggested workstream states:

```text
CREATED -> ACTIVE -> REVIEWING -> READY_TO_MERGE -> MERGED
                        |               |
                        +-> BLOCKED     +-> CONFLICT
```

Each task creates independent Coder, Reviewer, and Security runs with workstream-specific context. An approved AI patch must be validated against the latest workstream revision before it is applied.

The collaboration scope is explicit:

| Feature | Scope |
| --- | --- |
| Members and capabilities | Team |
| Repository and Git history | Project |
| General chat | Team or project |
| Feature branch and worktree | Workstream |
| Realtime documents and presence | Workstream |
| Shared terminal and feature chat | Workstream |
| Task conversation | Task |
| Coder, Reviewer, and Security runs | Task |
| AI context | Task plus workstream |
| Merge | Workstream into project |

---

# Core Principles

## Local First

Every developer maintains a local replica of the repository.

```text
Alice                         Bob

Local SSD                     Local SSD

payments-api/                 payments-api/
├── src/                      ├── src/
├── tests/                    ├── tests/
└── go.mod                    └── go.mod

          ↖               ↗
            realtime sync
          ↙               ↘

               Charlie

               Local SSD

               payments-api/
               ├── src/
               ├── tests/
               └── go.mod
```

Code reads and local editing never need to wait for a remote filesystem.

The network is used to synchronize changes between local replicas.

---

## Multiplayer by Default

A workspace belongs to a team rather than an individual developer.

Members can:

* edit code simultaneously
* see remote cursors and selections
* observe active files
* communicate through team chat
* observe agent activity
* review AI proposals
* participate in approvals
* view shared terminal output
* coordinate tasks

---

## AI as a Team Member

Conflux does not give every developer independent agents.

The workspace owns a **shared AI engineering team**.

```text
Workspace

├── Coder
├── Reviewer
└── Security
```

All developers see the same logical agents and their activity.

Agent executions are task-specific, allowing multiple tasks to run concurrently without turning the workspace into one enormous AI conversation.

---

## Humans Remain in Control

Human edits can enter the collaborative workspace immediately.

AI-generated edits follow a different path:

```text
AI generates change
        │
        ▼
Candidate Patch
        │
        ▼
Automated Review
        │
        ▼
Security Review
        │
        ▼
Human Approval
        │
        ▼
Canonical Workspace
```

The AI therefore cannot silently modify the team's canonical workspace.

---

# User Workflow

## 1. Sign In

The developer launches the Conflux desktop application and authenticates.

```text
┌──────────────────────────────────────┐
│                                      │
│               CONFLUX                │
│                                      │
│    Multiplayer AI Development        │
│                                      │
│       [ Continue with GitHub ]       │
│                                      │
└──────────────────────────────────────┘
```

---

## 2. Create or Join a Team

A user can create a team or join an existing one.

Example:

```text
Team: Payments

Alice       ADMIN
Bob         TEAM_LEAD
Charlie     DEVELOPER
David       VIEWER
```

Team membership and permissions are managed by the Identity and Team Service.

---

# Team Hierarchy

Conflux supports hierarchical roles.

Example default hierarchy:

```text
ADMIN
  │
  ▼
TEAM_LEAD
  │
  ▼
SENIOR_DEVELOPER
  │
  ▼
DEVELOPER
  │
  ▼
VIEWER
```

Roles should not be hardcoded directly into every business rule.

Conflux uses:

```text
Role
+
Capabilities
+
Leadership Priority
```

Example capabilities:

```text
OPEN_WORKSPACE

EDIT_CODE

START_AGENT

CANCEL_AGENT

RUN_TERMINAL

CONTROL_TERMINAL

APPROVE_AGENT_CHANGE

MANAGE_MEMBERS

MANAGE_ROLES

CREATE_CHECKPOINT

MANAGE_WORKSPACE
```

---

# Session Leadership

The team Admin does not need to remain online for the workspace to function.

Conflux selects an eligible online member using leadership priority.

Example:

```text
Alice       ADMIN          OFFLINE

Bob         TEAM_LEAD      ONLINE

Charlie     DEVELOPER      ONLINE
```

Bob becomes:

```text
SESSION LEADER
```

Session leadership grants operational authority without transferring ownership.

A Session Leader may be able to:

```text
✓ approve agent operations

✓ start or stop agents

✓ control workspace operations

✓ transfer terminal control

✓ create checkpoints

✓ resolve session decisions
```

but cannot automatically:

```text
✗ remove the Admin

✗ transfer ownership

✗ promote themselves to Admin

✗ delete the organization
```

---

# Opening a Workspace

Suppose Alice opens:

```text
~/projects/payments-api
```

Conflux detects:

```text
Repository

payments-api

Branch
main

HEAD
abc123
```

Alice chooses:

```text
Share Workspace with Team
```

Alice creates or selects a workstream for the feature she is developing. Other online members receive:

```text
Alice opened:

payments-api

main @ abc123

[ Join Workstream ]
```

Each active workstream maps to its own Git branch and may use a dedicated Git worktree so unfinished changes do not interfere with unrelated features.

---

# Repository Distribution

Conflux does not require its backend to permanently store the source repository.

A new workspace participant needs an initial repository copy.

When possible, this can come from:

```text
Existing Git Remote

or

Authorized Peer
```

For peer transfer:

```text
Alice
Local Repository
       │
       │ encrypted peer transfer
       ▼
Bob
Local Repository
```

After the initial synchronization, each developer operates against their own local replica.

A fundamental limitation remains:

If the repository has no external Git remote and no authorized member containing a copy is online, a completely new member cannot obtain repository bytes until a source becomes available.

---

# Real-Time Code Synchronization

Conflux does not synchronize entire files after every keystroke.

Active collaborative documents within the same workstream use a CRDT-based document model.

Reference implementation:

**Yjs**

The editing path is:

```text
Alice types
     │
     ▼
Local Editor
     │
     ▼
Local CRDT Document
     │
     ▼
Realtime Sync
     │
     ├────────────► Bob
     │
     └────────────► Charlie
```

Bob and Charlie apply the operation to their own document replicas.

Local typing never waits for network acknowledgement.

```text
KEYPRESS
   │
   ├────────────► Local editor immediately
   │
   └────────────► asynchronous synchronization
                            │
                            ▼
                         peers
```

This provides low perceived latency even when collaborators are geographically separated.

---

# Concurrent Editing

Multiple developers may modify the same document simultaneously.

Example:

```text
auth.go

18 │ func authenticate() {
19 │
20 │   validateToken()       ← Alice
21 │
...
79 │
80 │   createSession()       ← Bob
81 │
82 │ }
```

The CRDT layer merges concurrent text operations and causes connected replicas to converge toward the same document state.

Conflux should not use last-write-wins for active collaborative source documents.

---

# Presence

Collaborators can see:

* online members
* active document
* cursor location
* selections
* typing state
* session leader
* agent activity

Example:

```text
auth.go

42 │ func ValidateToken(...) {
43 │
44 │     validateExpiry()
         ↑
         Bob
```

Presence information is ephemeral and does not need permanent database storage.

---

# Git and CRDT Have Different Responsibilities

CRDT synchronization does not replace Git.

```text
CRDT

milliseconds
     │
     ▼
Realtime collaboration
```

Git provides:

```text
Git

durable history
     │
     ▼
Version control
```

A development session may contain thousands of collaborative edits before the team creates a meaningful Git checkpoint.

---

# Shared AI Team

Each project has shared logical AI roles, instantiated as independent runs for each workstream task.

Initial agents:

```text
Coder

Reviewer

Security
```

An optional Test Agent may be introduced later.

---

# Agent Responsibilities

## Coder Agent

Responsible for:

* repository investigation
* understanding tasks
* implementation planning
* code generation
* candidate patch creation
* responding to reviewer feedback
* producing revised patches

The Coder is normally the only AI role allowed to generate candidate code modifications.

---

## Reviewer Agent

Responsible for:

* reviewing Coder patches
* identifying bugs
* checking maintainability
* checking architecture
* finding edge cases
* validating implementation quality

The Reviewer does not directly modify the canonical workspace.

It returns findings to the orchestration system.

---

## Security Agent

Responsible for:

* security review
* authentication concerns
* authorization concerns
* secret exposure
* unsafe input handling
* injection risks
* dependency concerns
* insecure configurations
* dangerous execution patterns

The Security Agent also does not directly modify the canonical workspace.

---

# Multi-Agent Workflow

A developer requests:

```text
@Coder Implement password reset.
```

Conflux creates:

```text
TASK #392

Implement password reset
```

The workflow becomes:

```text
User Request
     │
     ▼
Agent Orchestrator
     │
     ▼
Coder
     │
     ▼
Candidate Patch v1
     │
     ├───────────────┐
     ▼               ▼
Reviewer          Security
     │               │
     └───────┬───────┘
             ▼
          Findings
             │
             ▼
           Coder
             │
             ▼
      Candidate Patch v2
             │
             ▼
          Tests
             │
             ▼
      Human Approval
             │
             ▼
    Canonical Workspace
```

---

# Shared Agents, Task-Specific Runs

Developers share logical agents.

```text
@Coder

@Reviewer

@Security
```

Internally, executions belong to tasks.

```text
Coder Role

├── CoderRun(Task #101)
├── CoderRun(Task #102)
└── CoderRun(Task #103)
```

This allows Conflux to process independent work concurrently.

---

# Parallel Agent Tasks

Agent tasks should not directly mutate canonical collaborative documents.

Suppose:

```text
Task #101
Modify auth.go

Task #102
Modify auth.go
```

Each task produces an isolated candidate patch.

```text
                    Shared Workspace
                          │
             ┌────────────┴────────────┐
             │                         │
         Task #101                 Task #102
             │                         │
      Candidate Patch           Candidate Patch
             │                         │
      Review + Security         Review + Security
             │                         │
      Human Approval            Human Approval
             └────────────┬────────────┘
                          ▼
                 Canonical Workspace
```

Before an approved patch is applied, Conflux validates it against the current workspace version.

Conflicting patches must be resolved rather than silently overwriting current work.

---

# Human vs AI Editing

Human editing:

```text
Developer
    │
    ▼
Editor
    │
    ▼
CRDT
    │
    ▼
Shared Workspace
```

AI editing:

```text
Agent
    │
    ▼
Candidate Patch
    │
    ▼
Reviewer
    │
    ▼
Security
    │
    ▼
Approval Policy
    │
    ▼
Shared Workspace
```

This separation is a core security principle.

---

# Approval System

Consequential AI actions may require human approval.

Example:

```text
Candidate Patch #83

Task:
Implement password reset

Files changed:
6

+183
-12

Coder       ✓ Complete

Reviewer    ✓ Passed

Security    ✓ Passed

Tests       ✓ 47/47

Required approvals:
2

Alice       ✓ Approved

Bob         ○ Waiting
```

Only after the configured policy succeeds can the patch enter the canonical workspace.

---

# Shared Terminal

Each active workstream exposes one logical shared terminal rather than one terminal for the entire project.

The terminal executes on exactly one designated machine.

```text
Alice ─────┐
           │
Bob ───────┼────► Shared Terminal
           │
Charlie ───┘
                 │
                 ▼
           Execution Host
                 │
                 ▼
                PTY
                 │
                 ▼
               Shell
```

Example:

```text
Execution Host

Bob's MacBook
```

All authorized members can observe terminal output.

Only the active terminal controller can provide interactive input.

---

# Terminal Control

Example:

```text
Terminal Controller

Bob
```

Another user may request control:

```text
Bob is controlling the terminal.

[ Request Control ]
```

The controller or Session Leader can transfer control.

```text
Transfer Control

○ Alice

● Bob

○ Charlie
```

This prevents multiple developers from sending conflicting terminal input simultaneously.

---

# AI Terminal Access

AI agents do not receive unrestricted shell access.

Prefer structured operations:

```text
RunTests

RunBuild

RunLinter

GitStatus
```

over:

```text
ExecuteAnything(command)
```

Agent command requests pass through authorization and policy validation.

```text
Agent
   │
   ▼
Command Request
   │
   ▼
Policy Engine
   │
   ├──── DENY
   │
   └──── ALLOW
          │
          ▼
    Execution Host
```

---

# Team and Workstream Chat

Conflux separates broad coordination from feature-specific discussion.

Team or project chat is used for announcements and coordination across workstreams. Workstream chat contains feature discussion, task context, and agent mentions. Mentioning an agent profile in workstream chat creates a task whose runs inherit that workstream's context.

Example:

```text
┌───────────────────────────────────┐
│ TEAM CHAT                         │
│                                   │
│ Alice                             │
│ I'm updating the auth handler.    │
│                                   │
│ Bob                               │
│ I'll handle tests.                │
│                                   │
│ Charlie                           │
│ @Coder check token validation.    │
│                                   │
│ ────────────────────────────────  │
│ Message team...                   │
└───────────────────────────────────┘
```

```text
# authentication

Alice:
@Coder investigate refresh-token expiry.

David:
Also check session invalidation.

CoderRun #501:
Investigating in feature/auth-refresh.
```

Supported mentions may include:

```text
@Alice

@Bob

@team

@Coder

@Reviewer

@Security

@agents
```

---

# Desktop Experience

Conflux is a desktop development environment rather than a web application packaged as a desktop shell.

Reference UI:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Conflux   payments-api    main ●       Alice Bob Charlie       Agents 3/3 │
├──────────────┬──────────────────────────────────────┬───────────────────────┤
│ EXPLORER     │ auth.go                              │ TEAM                  │
│              │                                      │                       │
│ ▼ src        │ 21 func Authenticate(...) {          │ Alice                 │
│   ▼ auth     │ 22                                   │ Working on auth        │
│     auth.go  │ 23   validateToken()                 │                       │
│     token.go │        ↑ Bob                         │ Bob                   │
│              │ 24                                   │ Check line 48          │
│ ▼ tests      │ 25   createSession()                 │                       │
│              │                                      │ Security Agent        │
│              │                                      │ Found 1 issue          │
│              │                                      │                       │
│              │                                      │ Message team...        │
├──────────────┴──────────────────────────────────────┴───────────────────────┤
│ TERMINAL                                                                    │
│                                                                             │
│ $ go test ./...                                                             │
│ ok   project/auth    0.241s                                                 │
│ ok   project/users   0.192s                                                 │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ main ●   3 users online   Coder ●   Reviewer ●   Security ●   Bob: Leader │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# Desktop Technology

Conflux uses:

```text
Tauri 2
+
Rust
+
React
+
TypeScript
```

Recommended desktop stack:

| Purpose                 | Technology     |
| ----------------------- | -------------- |
| Desktop framework       | Tauri 2        |
| Native runtime          | Rust           |
| UI                      | React          |
| Language                | TypeScript     |
| Build tooling           | Vite           |
| Styling                 | Tailwind CSS   |
| Components              | shadcn/ui      |
| Code editor             | Monaco Editor  |
| Collaborative documents | Yjs            |
| Terminal UI             | xterm.js       |
| Server/API state        | TanStack Query |
| UI state                | Zustand        |

---

# Local Runtime

Every Conflux installation contains a trusted native runtime implemented through Tauri/Rust.

```text
Conflux Desktop

React / TypeScript
       │
       ▼
Tauri Commands
       │
       ▼
Rust Local Runtime
       │
       ├── Filesystem
       ├── Git
       ├── PTY
       ├── Workspace
       ├── Local synchronization
       ├── Peer transport
       └── Secure credential storage
```

React should not receive unrestricted filesystem or shell access.

Sensitive native operations go through controlled Tauri commands.

---

# State Ownership

Different types of state require different synchronization mechanisms.

```text
Active source documents
        │
        ▼
       CRDT


Cursor / presence
        │
        ▼
Ephemeral realtime events


Team chat
        │
        ▼
PostgreSQL + realtime events


Repository history
        │
        ▼
       Git


Initial repository transfer
        │
        ▼
Git Remote / Peer Transfer


AI proposals
        │
        ▼
Structured Candidate Patches


Terminal
        │
        ▼
Per-Workstream Execution Host + PTY Stream


Authorization
        │
        ▼
RBAC + Policy Engine
```

---

# Backend Architecture

The target architecture uses three Java services and one Python Agent Service. They remain separate because they own different state and have different latency and scaling requirements.

```text
                         CONFLUX DESKTOP
                    Tauri + React + TypeScript
                              │
                       REST / WebSocket
                              │
             ┌────────────────┬───────────────┬────────────────┐
             ▼                ▼               ▼                ▼
       COLLABORATION       IDENTITY        WORKSPACE          AGENT
          SERVICE          AND TEAM         SERVICE           SERVICE
       Java/WebFlux      Java/Spring      Java/Spring         Python
       workstream WS     auth and RBAC    Git semantics     task-scoped runs
       Yjs/presence      membership       patches/merge     review pipeline
```

Internal RPC and Protocol Buffers are introduced only when a cross-service feature requires them. They are not part of the initial convergence proof.

---

# Collaboration Service

**Language:** Java

**Framework:** Spring WebFlux with Reactor Netty

The Collaboration Service owns the latency-sensitive realtime path. It does not own durable team, project, task, or Git business rules.

Primary question:

> Which authorized clients are connected, and how do their live changes converge?

Responsibilities:

```text
Presence

WebSocket connections

Realtime workstream events

CRDT update relay

Active document sessions

Cursor synchronization

Reconnect / resynchronization

Workstream room membership after join authorization

Realtime workstream chat fanout

Terminal output fanout
```

Yjs updates use binary WebSocket frames and are treated as opaque data by the first server implementation. Database access and service-to-service calls never occur for each keystroke.

---

# Identity and Team Service

**Language:** Java

**Framework:** Spring Boot

The existing Java identity service provides the authentication foundation and grows to own team-level identity, authorization, and leadership rules.

Primary question:

> Who is this user, and what are they allowed to do?

Responsibilities:

```text
Authentication

User registration and verified email identities

Local and external identities

JWT sessions, refresh rotation, logout, and revocation

Authentication rate limiting and security cleanup

Teams, invitations, and membership

Capabilities and leadership priority

Team and project chat
```

The Collaboration Service consumes the authenticated identity and applies team/workstream authorization when a client joins a realtime room.

---

# Agent Service

**Language:** Python

**Framework:** FastAPI with an asynchronous HTTP/event-streaming runtime

The initial implementation may use the OpenAI Agents SDK for Python for tool execution, guardrails, streaming, tracing, and resumable task runs. Conflux still owns task, workstream, patch, approval, and authorization semantics rather than delegating those product rules to the SDK.

The Agent Service owns AI execution and orchestration.

Primary question:

> What should the AI engineering team do next?

Responsibilities:

```text
Agent profiles for Coder, Reviewer, and Security

Task-scoped CoderRun, ReviewerRun, and SecurityRun instances

Task lifecycle

Parallel agent execution

LLM integration

Context management

Tool selection

Tool calls

Worker pools

Retries

Timeouts

Cancellation

Agent event streaming

Usage accounting

Cost controls

Prompt-injection protection
```

Agent runs are scoped to a task and its workstream. Runs in unrelated workstreams do not share conversation or repository context. Redis Streams may be added only when in-process execution no longer meets measured durability or scaling needs.

---

# Workspace Service

**Language:** Java

**Framework:** Spring Boot

The Workspace Service owns durable workspace and development-operation semantics.

Primary question:

> What is the current development workspace, and how can it safely be manipulated?

Responsibilities:

```text
Workspace metadata

Projects and workstreams

Workstream lifecycle and participants

Repository metadata

Repository synchronization metadata

Git state

Branches

Local worktree mapping and policy

Git checkpoints

File metadata

Document metadata

Workspace versions

Workspace snapshots

Diff generation

Candidate patches

Patch validation

Patch application

Approval workflows

Approval quorum

Build definitions

Test definitions

Command policies

Terminal control permissions

Terminal-session metadata

Execution-host coordination

Workspace consistency checks

Cross-workstream path and line-range overlap detection

Update-from-base and merge lifecycle
```

The Java Workspace Service records shared metadata and policy. The trusted Tauri/Rust runtime performs filesystem, Git-worktree, and PTY operations on each developer machine. The Workspace Service is not placed in the realtime keystroke path.

---

# Critical Realtime Path

Typing must remain extremely lightweight.

Do not route every keystroke through all backend services.

Correct path:

```text
Alice
 │
 ▼
Local Yjs
 │
 ▼
Realtime Collaboration Service
 │
 ▼
Local Yjs
 │
 ▼
Bob
```

Avoid:

```text
Alice
 │
 ▼
Collaboration
 │
 ▼
Workspace Java
 │
 ▼
Database
 │
 ▼
Collaboration
 │
 ▼
Bob
```

The second architecture adds unnecessary latency and failure points.

---

# Data Layer

Development may use one PostgreSQL server with isolated service databases or schemas.

```text
PostgreSQL

├── collaboration_db
│
├── identity_db
│
├── agent_db
│
└── workspace_db
```

Each service owns its data.

Services must not directly query another service's tables. When a cross-service call is required, it uses an explicit versioned contract; gRPC is introduced only when its operational cost is justified.

Redis is used for:

```text
Presence

Pub/Sub

Realtime fanout

Agent queues

Redis Streams

Short-lived distributed state

Caching
```

Redis is not the primary source of durable business data.

---

# Protocol Buffers

Reference structure:

```text
proto/

├── collaboration/
│   └── v1/
│       └── collaboration.proto
│
├── identity/
│   └── v1/
│       └── identity.proto
│
├── agent/
│   └── v1/
│       └── agent.proto
│
├── workspace/
│   └── v1/
│       └── workspace.proto
│
└── common/
    └── v1/
        ├── user.proto
        ├── workspace.proto
        ├── task.proto
        ├── patch.proto
        └── error.proto
```

Buf is used for:

```text
Proto linting

Code generation

Breaking-change detection

Java generation

Python generation
```

---

# Reference Monorepo Structure

```text
conflux/
│
├── desktop/
│   │
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── layouts/
│   │   │
│   │   ├── editor/
│   │   │   ├── monaco/
│   │   │   ├── collaboration/
│   │   │   ├── cursors/
│   │   │   └── documents/
│   │   │
│   │   ├── explorer/
│   │   ├── terminal/
│   │   ├── chat/
│   │   ├── agents/
│   │   ├── teams/
│   │   ├── workspace/
│   │   ├── approvals/
│   │   ├── presence/
│   │   ├── hooks/
│   │   ├── stores/
│   │   ├── api/
│   │   └── types/
│   │
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── filesystem/
│   │   │   ├── git/
│   │   │   ├── terminal/
│   │   │   ├── workspace/
│   │   │   ├── sync/
│   │   │   ├── peer/
│   │   │   ├── security/
│   │   │   ├── credentials/
│   │   │   └── commands/
│   │   │
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── services/
│   │
│   ├── collaboration/
│   │   ├── src/
│   │   │   ├── main/java/conflux/collaboration/
│   │   │   │   ├── presence/
│   │   │   │   ├── realtime/
│   │   │   │   ├── documents/
│   │   │   │   └── rooms/
│   │   │   └── test/
│   │   ├── pom.xml
│   │   └── Dockerfile
│   │
│   ├── identity/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── java/
│   │   │   │   │   └── conflux/
│   │   │   │   │       ├── auth/
│   │   │   │   │       ├── teams/
│   │   │   │   │       ├── members/
│   │   │   │   │       ├── roles/
│   │   │   │   │       ├── leadership/
│   │   │   │   │       ├── chat/
│   │   │   │   │       └── grpc/
│   │   │   │   └── resources/
│   │   │   └── test/
│   │   ├── pom.xml
│   │   └── Dockerfile
│   │
│   ├── agent/
│   │   ├── src/
│   │   │   └── conflux_agent/
│   │   │       ├── orchestrator/
│   │   │       ├── profiles/
│   │   │       ├── runs/
│   │   │       ├── tasks/
│   │   │       ├── llm/
│   │   │       ├── context/
│   │   │       ├── tools/
│   │   │       ├── policies/
│   │   │       └── usage/
│   │   ├── tests/
│   │   ├── pyproject.toml
│   │   ├── uv.lock
│   │   └── Dockerfile
│   │
│   └── workspace/
│       ├── src/
│       │   ├── main/
│       │   │   ├── java/
│       │   │   │   └── conflux/
│       │   │   │       ├── workspace/
│       │   │   │       ├── repository/
│       │   │   │       ├── documents/
│       │   │   │       ├── git/
│       │   │   │       ├── patches/
│       │   │   │       ├── tests/
│       │   │   │       ├── terminal/
│       │   │   │       ├── execution/
│       │   │   │       ├── policy/
│       │   │   │       └── grpc/
│       │   │   │
│       │   │   └── resources/
│       │   │
│       │   └── test/
│       │
│       ├── pom.xml
│       └── Dockerfile
│
├── proto/
│   ├── collaboration/
│   │   └── v1/
│   │       └── collaboration.proto
│   │
│   ├── identity/
│   │   └── v1/
│   │       └── identity.proto
│   │
│   ├── agent/
│   │   └── v1/
│   │       └── agent.proto
│   │
│   ├── workspace/
│   │   └── v1/
│   │       └── workspace.proto
│   │
│   └── common/
│       └── v1/
│           ├── user.proto
│           ├── workspace.proto
│           ├── task.proto
│           ├── patch.proto
│           └── error.proto
│
├── infrastructure/
│   ├── docker/
│   ├── postgres/
│   ├── redis/
│   ├── monitoring/
│   │   ├── prometheus/
│   │   ├── grafana/
│   │   └── tempo/
│   │
│   └── scripts/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   ├── security/
│   └── diagrams/
│
├── .github/
│   └── workflows/
│       ├── desktop.yml
│       ├── collaboration.yml
│       ├── identity.yml
│       ├── agent.yml
│       ├── workspace.yml
│       └── proto.yml
│
├── buf.yaml
├── buf.gen.yaml
├── docker-compose.yml
├── Makefile
├── README.md
└── LICENSE
```

---

# Technology Stack

| Area                    | Technology                   |
| ----------------------- | ---------------------------- |
| Desktop                 | Tauri 2                      |
| Native desktop runtime  | Rust                         |
| Frontend                | React                        |
| Frontend language       | TypeScript                   |
| Build tooling           | Vite                         |
| Code editor             | Monaco Editor                |
| Collaborative documents | Yjs / CRDT                   |
| Terminal UI             | xterm.js                     |
| Styling                 | Tailwind CSS                 |
| Components              | shadcn/ui                    |
| UI state                | Zustand                      |
| API state               | TanStack Query               |
| Realtime collaboration  | Java / Spring WebFlux       |
| Agent backend           | Python / FastAPI             |
| Initial agent runtime   | OpenAI Agents SDK for Python |
| Identity and team       | Java / Spring Boot           |
| Workspace backend       | Java / Spring Boot           |
| Java framework          | Spring Boot                  |
| Internal RPC            | gRPC                         |
| Contracts               | Protocol Buffers             |
| Proto tooling           | Buf                          |
| Desktop API             | REST                         |
| Realtime transport      | WebSockets                   |
| Database                | PostgreSQL                   |
| Cache / ephemeral state | Redis                        |
| Async jobs              | Redis Streams                |
| Authentication          | GitHub OAuth                 |
| Source control          | Git                          |
| Java Git integration    | JGit / controlled native Git |
| Containers              | Docker                       |
| Local infrastructure    | Docker Compose               |
| CI/CD                   | GitHub Actions               |
| Telemetry               | OpenTelemetry                |
| Metrics                 | Prometheus                   |
| Dashboards              | Grafana                      |
| Distributed tracing     | Tempo                        |

---

# Example Complete Workflow

Alice, Bob, and Charlie belong to the same team.

```text
Alice       ADMIN

Bob         TEAM_LEAD

Charlie     DEVELOPER
```

Alice opens:

```text
payments-api
```

Alice selects the Authentication workstream, backed by its own branch/worktree.

Bob joins the Authentication workstream while Charlie continues in the independent Payments workstream.

Alice and Bob synchronize active Authentication documents without receiving Charlie's unfinished Payments edits.

Bob asks:

```text
@Coder Implement password reset.
```

Conflux creates:

```text
Task #392
```

Coder investigates the current Authentication workstream.

Meanwhile Alice continues editing another file.

Her changes propagate to Bob and become visible to the agent through the latest Authentication workstream state.

Coder produces:

```text
Candidate Patch v1
```

Reviewer analyzes it.

Security analyzes it.

Reviewer finds an edge case.

Security finds no critical vulnerability.

Coder creates:

```text
Candidate Patch v2
```

Tests run on the designated execution host.

```text
47 / 47 tests passed
```

Conflux requests two approvals.

```text
Alice       ✓

Bob         ✓
```

The patch is validated against the latest workspace state.

If no conflicting changes exist, it enters the current collaborative workstream.

The CRDT synchronization layer propagates affected document changes.

```text
                    Approved Patch
                          │
                          ▼
              Authentication Workstream
                          │
                  ┌───────┴───────┐
                  ▼               ▼
                Alice            Bob
```

Every participant in the Authentication workstream now sees the accepted code.

A Git checkpoint captures the durable workstream state, which can later enter review and merge into `main`.

---

# Security Model

Conflux treats AI output as untrusted.

Important principles:

```text
No unrestricted AI filesystem access

No unrestricted AI shell access

Human approval for consequential changes

Explicit tool capabilities

RBAC

Workspace path validation

Patch validation

Repository isolation

Command policies

Audit logging

Secure credential storage

Least-privilege OAuth scopes

Rate limiting

LLM cost limits

Agent cancellation

Agent timeouts

Prompt-injection defenses
```

Repository contents themselves must also be treated as potentially hostile input to agents.

Instructions contained inside source files must never override Conflux's system policies or tool authorization rules.

---

# Failure Scenarios

Conflux must eventually handle:

```text
Member disconnects

Session Leader disconnects

Execution Host disconnects

Network partition

WebSocket reconnect

CRDT resynchronization

Concurrent edits

Agent cancellation

Agent failure

LLM timeout

Peer unavailable

Patch conflicts

Workspace version mismatch

Terminal process failure

Redis failure

Service restart
```

These should be treated as normal distributed-system states rather than exceptional edge cases.

---

# Development Strategy

The first milestone should contain **no AI**.

## Milestone 1 - Multiplayer Editor

Build:

```text
Two desktop clients

        ↓

Join same hardcoded workstream

        ↓

Open same document

        ↓

Alice types

        ↓

Bob sees change

        ↓

Bob types simultaneously

        ↓

Alice sees change

        ↓

Both documents converge

        ↓

Both local files persist correctly
```

Also implement remote cursors and reconnect synchronization.

If this layer is unreliable, AI agents will only make the system harder to debug.

---

## Milestone 2 - Team System

Implement:

```text
Authentication

Teams

Membership

RBAC

Hierarchy

Session leadership

Presence

Team chat
```

---

## Milestone 3 - Projects and Workstreams

Implement:

```text
Repository detection

Project registration

Workstreams mapped to Git branches/worktrees

Workstream switching and isolation

Git state

Repository metadata

Workstream versions

Initial repository synchronization

File explorer

Git checkpoints
```

---

## Milestone 4 - Shared Terminal

Implement:

```text
xterm.js

Local PTY

Execution Host

Terminal streaming

Terminal controller

Control transfer

Disconnect handling
```

---

## Milestone 5 - Agent Foundation

Implement:

```text
Agent Service

Task lifecycle

LLM provider

Tool calling

Agent events

Coder Agent

Candidate patches
```

---

## Milestone 6 - Multi-Agent Pipeline

Add:

```text
Reviewer Agent

Security Agent

Parallel execution

Review findings

Patch revision

Testing pipeline
```

---

## Milestone 7 - Human-in-the-Loop

Implement:

```text
Approval policies

Approval quorum

RBAC integration

Patch validation

Conflict detection

Canonical workspace application

Audit history
```

---

## Milestone 8 - Production Engineering

Add:

```text
Distributed tracing

OpenTelemetry

Prometheus

Grafana

Structured logging

Rate limiting

Retry policies

gRPC deadlines

Circuit breaking where appropriate

Idempotency

Load testing

Integration testing

Security testing

CI/CD

Production deployment
```

---

# Non-Goals for the Initial Version

The first version should not attempt to implement:

```text
Full VS Code replacement

Every programming language

Fully decentralized P2P infrastructure

Arbitrary AI shell access

Automatic synchronization of every repository file on every keystroke

Custom CRDT implementation

Custom Git implementation

Unlimited autonomous agents

Automatic merge of every patch conflict
```

Conflux should initially synchronize **active collaborative documents** and expand workspace synchronization carefully.

---

# Project Goals

Conflux is intended to explore production-grade engineering concepts including:

```text
Distributed systems

Realtime systems

Collaborative editing

CRDTs

Microservices

Java concurrency, virtual threads, and reactive streams

Java / Spring Boot

Python async agent orchestration

Rust native development

Tauri

React

TypeScript

gRPC

Protocol Buffers

WebSockets

Peer-to-peer networking

PostgreSQL

Redis

Git internals

Authentication

RBAC

Leader coordination

Human-in-the-loop AI

Multi-agent orchestration

LLM tool calling

Secure code execution

Observability

Containerization

CI/CD
```

---

# What Makes Conflux Different

Conflux is not intended to be another single-user AI coding assistant.

Its core model is:

```text
Humans
   +
Shared Code
   +
Per-Workstream Terminal
   +
Shared Communication
   +
Shared AI Engineering Team
```

All operating inside isolated collaborative workstreams with project-wide visibility.

The goal is not simply:

```text
AI writes code.
```

The goal is:

```text
Developers and AI agents
collaborate on the same codebase,
at the same time,
with shared context,
shared visibility,
controlled execution,
and human authority.
```

---

# Status

**Architecture / Early Development**

The initial engineering focus is the local-first multiplayer editor and workspace synchronization layer.

AI functionality will be introduced only after realtime human collaboration is reliable.

---

# Conflux
