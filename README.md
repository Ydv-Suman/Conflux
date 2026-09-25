# Conflux

> A local-first multiplayer development environment where developers and specialized AI agents work together on the same synchronized codebase in real time.

Conflux is a collaborative desktop IDE designed for software teams working with AI.

Instead of giving every developer an isolated AI coding assistant, Conflux creates a **shared development workspace** where team members and specialized AI agents collaborate on the same repository.

Developers can edit code together in real time, see each other's cursors and changes, communicate through team chat, use a shared terminal, assign tasks to a shared AI engineering team, review AI-generated changes, and approve consequential actions before they enter the canonical workspace.

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

Team membership and permissions are managed by the Collaboration Service.

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

Other online members receive:

```text
Alice opened:

payments-api

main @ abc123

[ Join Workspace ]
```

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

Active collaborative documents use a CRDT-based document model.

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

Each workspace has shared logical AI roles.

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

Each collaborative workspace exposes one logical shared terminal.

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

# Team Chat

Each workspace contains persistent team communication.

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
Single Execution Host + PTY Stream


Authorization
        │
        ▼
RBAC + Policy Engine
```

---

# Backend Architecture

Conflux uses three backend services.

```text
                         CONFLUX DESKTOP
                    Tauri + React + TypeScript
                              │
                       REST / WebSocket
                              │
                              ▼
              ┌─────────────────────────────┐
              │   COLLABORATION SERVICE     │
              │             Go              │
              └──────────────┬──────────────┘
                             │
                            gRPC
                 ┌───────────┴───────────┐
                 ▼                       ▼
      ┌─────────────────────┐   ┌─────────────────────┐
      │    AGENT SERVICE    │◄─►│  WORKSPACE SERVICE  │
      │         Go          │   │        Java         │
      └─────────────────────┘   └─────────────────────┘
```

Internal service communication uses:

```text
gRPC
+
Protocol Buffers
```

---

# Collaboration Service

**Language:** Go

The Collaboration Service owns the human and realtime collaboration domain.

Primary question:

> Who is collaborating, and what are they allowed to do?

Responsibilities:

```text
Authentication

Teams

Members

Invitations

Roles

RBAC

Leadership priority

Session leadership

Presence

Team chat

WebSocket connections

Realtime workspace events

CRDT update relay

Active document sessions

Cursor synchronization

Reconnect / resynchronization

Approval workflows

Approval quorum

Agent permissions

Terminal control permissions
```

---

# Agent Service

**Language:** Go

The Agent Service owns AI execution and orchestration.

Primary question:

> What should the AI engineering team do next?

Responsibilities:

```text
Agent Orchestrator

Coder Agent

Reviewer Agent

Security Agent

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

Agent workloads can use Redis Streams for asynchronous processing.

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

Repository metadata

Repository synchronization metadata

Git state

Branches

Git checkpoints

File metadata

Document metadata

Workspace versions

Workspace snapshots

Diff generation

Candidate patches

Patch validation

Patch application

Build definitions

Test definitions

Command policies

Terminal-session metadata

Execution-host coordination

Workspace consistency checks
```

The Java Workspace Service is not placed in the realtime keystroke path.

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
Collaboration Service
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
├── agent_db
│
└── workspace_db
```

Each service owns its data.

Services must not directly query another service's tables.

Cross-service access occurs through gRPC contracts.

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

Go generation

Java generation
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
│   │   ├── cmd/
│   │   │   └── server/
│   │   │
│   │   ├── internal/
│   │   │   ├── auth/
│   │   │   ├── teams/
│   │   │   ├── members/
│   │   │   ├── roles/
│   │   │   ├── permissions/
│   │   │   ├── leadership/
│   │   │   ├── presence/
│   │   │   ├── chat/
│   │   │   ├── realtime/
│   │   │   ├── documents/
│   │   │   ├── approvals/
│   │   │   ├── terminal/
│   │   │   └── grpc/
│   │   │
│   │   ├── migrations/
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   ├── agent/
│   │   ├── cmd/
│   │   │   └── server/
│   │   │
│   │   ├── internal/
│   │   │   ├── orchestrator/
│   │   │   ├── agents/
│   │   │   │   ├── coder/
│   │   │   │   ├── reviewer/
│   │   │   │   └── security/
│   │   │   │
│   │   │   ├── tasks/
│   │   │   ├── workers/
│   │   │   ├── llm/
│   │   │   ├── context/
│   │   │   ├── tools/
│   │   │   ├── policies/
│   │   │   ├── usage/
│   │   │   └── grpc/
│   │   │
│   │   ├── migrations/
│   │   ├── go.mod
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
| Collaboration backend   | Go                           |
| Agent backend           | Go                           |
| Workspace backend       | Java                         |
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

Bob and Charlie join the workspace.

All three now have synchronized local workspace replicas.

Bob asks:

```text
@Coder Implement password reset.
```

Conflux creates:

```text
Task #392
```

Coder investigates the current shared workspace.

Meanwhile Alice continues editing another file.

Her changes propagate to Bob and Charlie and become visible to the agent through the current shared workspace state.

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

If no conflicting changes exist, it enters the canonical collaborative workspace.

The CRDT synchronization layer propagates affected document changes.

```text
                    Approved Patch
                          │
                          ▼
                 Canonical Workspace
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           Alice         Bob        Charlie
```

Every developer now sees the accepted code.

A Git checkpoint can then capture the durable repository state.

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

Join same workspace

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

## Milestone 3 - Workspace

Implement:

```text
Repository detection

Workspace registration

Git state

Repository metadata

Workspace versions

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

Go concurrency

Java / Spring Boot

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
Shared Terminal
   +
Shared Communication
   +
Shared AI Engineering Team
```

All operating inside one synchronized development workspace.

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
