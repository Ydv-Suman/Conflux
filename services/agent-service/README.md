# Conflux Agent Service

Python and FastAPI service for Conflux AI assistance and task-scoped agent runs.
Repository-aware work belongs to an authorized team, project, and workstream;
unrelated workstreams must not share context implicitly.

## Current scope

This is the service scaffold. It provides a FastAPI application, a public health
endpoint, and generated API documentation. Agent runs, model providers,
authorization, persistence, and desktop integration are not implemented yet.
No model API key, database, or other Conflux service is needed to run the scaffold.

## Requirements

- Python 3.12; local development is pinned to **3.12.16**.
  We use this mature line for library compatibility. It receives security updates;
  see [Python release status](https://devguide.python.org/versions/).
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for the environment
  and locked dependencies.

## Run locally

From the repository root:

```bash
cd services/agent-service
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`uv sync` creates a local `.venv` and installs the dependencies recorded in
`uv.lock`. uv can download the configured Python version if needed. The first run
requires network access. Stop the development server with Ctrl+C.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process health |
| `/docs` | Interactive API documentation |
| `/redoc` | Alternative API documentation |
| `/openapi.json` | OpenAPI schema |

Check the running service:

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok","service":"agent-service"}
```

The health response confirms the process is running; it does not claim that model
providers or future dependencies are ready.

## First milestone: read-only Coder proposals

Build this workflow before returning to shared Git checkpoints:

1. Submit a task for the active project, team, and workstream. Verify identity and
   team capabilities before accepting runs or exposing their events/results.
2. Supply explicitly selected repository files through the desktop. Exclude
   secrets and private/ignored paths, and record the inputs used for the run.
   A client repository path is not a readable server filesystem path.
3. Run one Coder agent and stream progress, responses, and completion/failure.
4. Return a candidate patch without modifying shared documents or local working
   files. Validate its paths and present the before/after diff in Monaco.
5. Support cancellation, timeouts, usage/cost limits, and visible provider errors.

Acceptance: a user asks the Coder to change a file, watches progress, and reviews
the proposed diff. Canonical files remain unchanged.

Model-provider and agent-framework selection remains open. Add dependencies when
implementing that integration. Do not introduce command execution or file writes
as part of the read-only proposal milestone.

## AI-first collaboration design — draft

Status: proposed product and implementation design, 2026-11-15. Everything in
this section is planned unless explicitly identified as current above. The
endpoints, records, states, and controls below are design contracts to refine
during implementation; they are not available APIs. This section expands the
[next milestone in TODO](../../docs/TODO.md#next-milestone--coder-agent-proposals-planned).
It does not authorize command execution or patch application in that milestone.

### Product goal

AI is a primary way developers work in Conflux. Every developer should be able to
ask questions, investigate, and delegate substantial work. A team should be able
to follow that work, contribute context, take over a task, and review its result
without duplicating effort or losing concurrent human edits.

Conflux supplies shared task ownership, live-work awareness, identifiable inputs,
review, and controlled integration around an agent runtime. A terminal agent can
eventually be one execution backend within this workflow. Opening an agent chat
or running multiple models alone does not deliver the team workflow.

### Three connected experiences

Each member has **one personal assistant**. The team shares **two assistants**:
the Shared Task Agent and the Workstream Assistant. These two are not duplicated
for every member. For a team of five, the product presents five private personal
assistants and two shared team assistants.

| Experience | Main purpose | Visibility and behavior |
| --- | --- | --- |
| Personal assistant — one per member | Explain code, debug, explore alternatives, draft a task | Private to that member within the product; repository access and organization policy still apply |
| Shared Task Agent — shared by the team | Investigate or propose/implement defined tasks | Authorized participants share each task's thread, progress, candidates, and evidence |
| Workstream Assistant — shared by the team | Explain ongoing work, retrieve accepted decisions, prepare handoffs | Retrieves authorized workstream records with source references; cannot read private conversations |

One personal assistant can have multiple private conversations. Each conversation
retains its own project/workstream scope; having one assistant does not combine
all of a member's repository contexts. The two team assistants use the selected
project/workstream scope and never pool unrelated workstreams into one context.
The Shared Task Agent can serve multiple tasks through separate, bounded runs;
two shared assistants does not mean only two simultaneous execution slots.

These are product identities and scopes, not necessarily different models or
permanently running processes. Runtime capacity is allocated when work starts.
Coder, Reviewer, and Security are capability profiles with different instructions
and tools. Start with one worker per task. Invoke additional profiles when they
add useful evidence, rather than starting a fixed agent team for every request.

A personal investigation can become a shared task through an explicit preview:
the developer selects the messages, findings, files, and requirements to share.
Create a shared copy of that selection and retain its source references. Do not
expose the original private thread, hidden attachments, or later private messages.
Private means application visibility, not an assertion that model providers or
configured retention systems never process the conversation.

### Frontend workspace

The desktop should expose a persistent AI workspace alongside ordinary editing:

```text
Team / Project / Workstream                     Participants and connection
┌─────────────────────┬───────────────────────────┬─────────────────────────┐
│ Tasks & agents      │ Editor / Proposed changes │ Personal / Team task    │
│                     │ / Checks                  │                         │
│ My conversations    │                           │ Scope and visibility    │
│ Team tasks          │ Code or candidate diff    │ Task conversation       │
│ Questions for me    │ Changed-input warning     │ Progress and tool events│
│ Needs review        │ Review comments           │ Questions and handoffs  │
│                     │                           │                         │
│ Workstream context  │ Revise / Reject / Approve │ Message / Control / Stop│
└─────────────────────┴───────────────────────────┴─────────────────────────┘
```

- **Left:** tasks, owners, run status, review requests, and accepted decisions.
  Personal conversations are visibly separate from shared tasks.
- **Center:** Monaco editor, versioned candidate diffs, and checks. Clearly label
  proposed code; it is not saved collaborative content. An unexecuted check is
  shown as “Not run,” never as passing.
- **Right:** the selected conversation, shared visibility, active controller,
  progress, input requests, cancellation, and usage. Switching modes must not
  silently send a private draft or its attachments to a shared thread.

Expose three clear destinations in the AI panel: **My Assistant**, **Team Tasks**,
and **Workstream Assistant**. The first opens the current member's personal
assistant; the other two open the team's shared assistants in the active scope.
Show the privacy/scope label beside the composer before a message is sent.

Entry points include selected code, a diagnostic, a diff, the task list, and
workstream discussion. Before submission, show the destination, selected context,
execution mode, and budget. Switching workstreams clears inaccessible cached
content and prevents late responses from appearing in the new scope.

Progress means observable actions, summaries, tool results, and status events.
Do not depend on exposing a model's private reasoning. Notify the owner when a
run needs input, fails, or is ready for review; aggregate routine progress to
avoid notifying the whole team on every token.

### Task ownership and team control

Every shared task has an objective, acceptance criteria, one accountable owner,
authorized scope, and an ordered discussion. The requester, controller, reviewer,
approver, and agent are distinct identities even when one human fills several
roles.

| Action | Proposed rule |
| --- | --- |
| Inspect a task, stream, or candidate | Require current access to its scope and data |
| Add feedback | Authorized participants may comment; record author and sequence |
| Start or steer a run | Require the relevant capability and current task control |
| Transfer control | Explicit handoff; authorized takeover is recorded with a reason |
| Cancel | Owner/controller or a member with cancellation capability |
| Approve/apply | Separate capability, exact candidate approval, current access check |

Use centrally defined capabilities, not frontend role-name checks. Workstream
presence or session leadership alone does not grant agent control or approval.
Private conversations have narrower visibility than team membership.

Teammate comments do not become unordered simultaneous prompts. Persist comments
with attribution; show whether each is pending, included in a run turn, or
resolved. The controller selects or acknowledges feedback for the next turn.
Material requirement changes create a new task-specification version. A run
using an older specification is visibly out of date. Conflicting instructions
require a human decision rather than silently choosing the latest message.

Allow one active controlling turn per task initially. Use a server-enforced
control version and expiring lease to prevent two clients steering concurrently.
A disconnected owner does not cancel background execution. Lease expiry permits
an authorized handoff; it does not make the task public or grant new privileges.

### Context and team memory

Each run receives a bounded context package:

- Task specification version, acceptance criteria, and selected discussion.
- Team/project/workstream identity and authorized repository reference.
- Selected file contents, stable document IDs where available, paths, hashes,
  and capture metadata.
- Relevant accepted decisions, repository instructions, and related tasks.
- Prior candidate and review/test evidence when revising a result.
- Tool, network, credential, time, token, and spending policy.

Keep an immutable input manifest so reviewers can identify what the agent saw.
For the first milestone, files supplied by the desktop are client-supplied inputs,
not proof of authoritative shared state. Record them as such. A selection captured
at different times is not a consistent repository snapshot. File hashes identify
bytes; they do not establish trust, authorship, or workspace-wide consistency.

Exclude secrets, private paths, ignored paths, and unsupported/oversized content
before upload. Enforce path and size policy again on the server. Resolve symlinks
and repository boundaries safely; do not trust a client-supplied absolute path.
Secret detection is supplementary and cannot guarantee that allowed source files
contain no sensitive information. Show developers what will be sent.

Retrieve relevant context on demand within the same policy boundary. Record newly
retrieved inputs too. Do not continuously replace the run's inputs with live edits.
An optional update becomes an explicit new input version or run.

Shared memory starts with accepted, source-linked decisions and requirements.
Distinguish human agreement from agent suggestions; retain author, scope, date,
source version, and supersession history. Do not treat an agent summary as an
approved decision or use a universal conversation shared across workstreams.
Recheck source access when retrieving stored context. Repository text and tool
output are untrusted data and cannot grant capabilities or override policy.

### Run lifecycle and persistence

Keep task, run, and candidate states separate. A completed model run can still
produce an invalid or stale candidate, and does not mean the task is accepted.

```text
Task:      Open → In progress → In review → Done
                    ↕              ↕
                 Blocked       Changes requested
           Open/In progress/In review/Blocked → Cancelled

Run:       Queued → Running ↔ Waiting for input → Completed
                      │               │
                      └───────────────┴→ Failed / Cancelled / Timed out

Candidate: Proposed → Validating → Ready for review → Approved → Applying → Applied
                           │              │             │
                           └──────────────┴─────────────┴→ Stale / Rejected
```

Task transitions are explicit product actions; run completion alone does not
close a task. Cancellation and completion races have one durable winning terminal
transition. A cancelled run cannot publish an automatically approved result.
An application attempt separately records pending, applying, applied, failed, or
reconciliation-required status. An ambiguous interruption is not reported as
success or retried blindly; recover its durable receipt first.

Persist tasks, messages, run state, manifests, event sequences, usage, and result
references. Candidate and approval records belong to Workspace. A desktop can
disconnect and reconnect using an event cursor; it must not restart the task or
duplicate a paid model call. Do not put streamed tokens on the document-edit relay.

Use durable creation idempotency keys and worker leases. An initial bounded worker
pool backed by persistent run records is enough; Redis Streams is not required
without a measured need. After a service restart, reconcile interrupted runs.
Resume only when the provider/runtime supports trustworthy recovery; otherwise
mark the interrupted attempt and offer an explicit retry with possible extra cost.
Never promise exactly-once provider execution after an ambiguous network failure.

### Execution environments and providers

The first milestone uses read-only file inputs and returns a candidate. It cannot
run shell commands, modify files, install dependencies, or claim test execution.

Later implementation tasks run in a server-managed sandbox created from a
consistent captured revision. This lets work continue when the requester's laptop
closes. A local runner is an optional later backend with an explicit execution
host, host-online dependency, scoped policy, and disconnect behavior.

A Git worktree separates files but is not a security sandbox. Command execution
needs enforced filesystem/process/network limits, resource limits, ephemeral
credentials, and cleanup. Do not mount a developer's home directory or expose
production credentials. Tests and repository scripts can execute hostile code.

Start with one model-provider integration. Keep a small adapter contract for
starting, streaming, cancelling, reconciling, and collecting results. Conflux owns
product rules; a provider SDK does not own team authorization or approval.
Evaluate existing local/cloud agents as later backends rather than rebuilding all
their execution features. Import their output as an untrusted candidate with base
and execution evidence, subject to the same validation as native runs.

Runtime selection is unresolved. The architecture currently names OpenAI Agents
SDK as the initial runtime; evaluate it during the first provider integration and
update the architecture if the decision changes. ACP may help compatible editor
integrations, but is not a replacement for server orchestration, sandboxing, or
collaboration-state validation. Do not build several adapters before one works.

### Concurrent work and overlap awareness

Warn when a task's selected files intersect other active tasks, when a teammate
changes a captured input, or when candidates modify the same paths. Initially use
recorded inputs and actual proposed paths; label predicted scope as an estimate.
File activity is a coordination signal, not proof of ownership or contribution.

Use advisory warnings rather than locking files for the duration of a run.
Independent tasks may execute concurrently within team budgets. Overlapping tasks
can be sequenced by their owners. Start with bounded concurrency and no automatic
subagent fan-out. A full task-dependency scheduler can wait for demonstrated need.

Path overlap is incomplete evidence: different files can implement incompatible
API assumptions. Explicit task dependencies, accepted contracts, human review,
and tests remain necessary. Later symbol/dependency analysis can improve warnings
without being presented as a correctness guarantee.

### Candidates, review, and safe application

Each immutable candidate version records its producing run, base input manifest,
proposed changes, specification version, and validation evidence. Validate allowed
paths, expected originals, supported operations, size bounds, and patch structure.
Reject traversal, symlink escapes, unexpected files, and ambiguous patch results.
The initial proposal scope should favor modifications of explicitly supplied text
files; creation, rename, deletion, binary, and generated files need explicit rules.

Reviews and tests identify the exact candidate and environment they evaluated.
Show missing evidence honestly. A Reviewer can inspect correctness; a Security
profile can inspect relevant risks. Start with on-demand review and one bounded
revision loop. Agents do not approve their own work or replace required human
approval. Changing the candidate invalidates prior approval and dependent evidence.

Application is a later milestone and requires all of the following:

1. Workspace checks current access, task specification, candidate identity,
   approval policy, required evidence, and idempotency.
2. Compare against authoritative collaborative file-tree/document versions.
   Git HEAD alone misses uncommitted shared edits. Initially reject changes to
   any captured input; permit finer-grained revalidation only after it is defined.
3. Serialize candidate application per workstream. The queue coordinates agent
   applications, not all human editing. Revalidate after preceding applications.
4. Collaboration performs a conditional, durable application against the expected
   versions. The version check and accepted write must share an authoritative
   concurrency boundary; a check in Workspace followed by a later ordinary client
   edit is insufficient. Concurrent human updates must be ordered or cause the
   application to fail safely.
5. Publish normal collaborative updates and materialize them through existing
   desktop synchronization. Do not write directly to disk and bypass shared state.
6. Record a durable application receipt linking before/after versions, candidate,
   agent run, requester, and human approver. Reconcile lost responses from that
   receipt rather than applying twice.

Stale candidates return to revision or conflict resolution. A clean textual merge
does not establish behavioral correctness. Rebased or otherwise changed candidates
must be revalidated and reviewed under the approval policy.

Before enabling multi-file application, define an atomic change-set protocol and
restart/partial-failure recovery across the durable tree and documents. Per-file
Yjs transactions alone do not make a multi-file change atomic. Keep application
disabled until this protocol is implemented and tested; record a dedicated ADR.
Consistent snapshot capture is required for reproducible execution, but public
Git checkpoint publication need not be required for every agent run.

### Budgets, access, and audit

Enforce run deadlines, turn/tool limits, input/output bounds, and per-task/team
budgets. Reserve capacity before dispatch to prevent concurrent runs collectively
overspending the available allowance. Reconcile actual usage and release unused
reservations; limit provider output and disclose any unavoidable billing delay.
Do not claim that a displayed estimate is an exact hard monetary cap unless the
provider integration can enforce it. Retries and revisions consume the task budget.

Recheck access on run creation, context retrieval, event/result access, tool
execution, control transfer, and application. Membership revocation stops future
access and triggers cancellation of affected delegated execution. Revocation
cannot recall data already transmitted to a provider. Streams must be closed or
reauthorized within a defined revocation bound; browser caching is not permission.

Keep provider credentials server-side, scope runner credentials to the operation,
redact secret-bearing logs, and define retention/deletion for conversations,
uploaded inputs, artifacts, and audit evidence. Persist only the context needed;
do not copy whole repositories into every event. Audit control changes, sensitive
tool decisions, approvals, and applications. Agent changes retain agent provenance
separately from human review and existing edit attribution.

### Service responsibilities and proposed API surface

| Component | Responsibility |
| --- | --- |
| Agent Service | Personal/shared conversations, task specifications, owners/controllers, runs, context manifests, events, provider calls, usage, worker lifecycle |
| Workspace Service | Project/workstream authority, scope validation, candidate versions, approval policy and records, application coordination, checkpoint metadata |
| Collaboration Service | Authoritative shared tree/documents, capture versions, conditional shared application, durable update ordering and provenance |
| Identity Service | Authenticated identities, membership/capability authority |
| Desktop / Tauri | Context selection, permitted local file reads, Monaco diffs, collaboration sync, local Git and optional future local runner |

Agent Service stores references to candidates owned by Workspace. Workspace keeps
only task/run references needed for policy and integration; avoid competing task
or document authorities. Changes between services require idempotent requests,
receipts, and reconciliation rather than an assumed cross-service transaction.

Proposed operations, subject to contract review:

| Owner | Operations |
| --- | --- |
| Agent | Create/list personal conversations; append messages; preview/share selected context into a task |
| Agent | Create/list/get scoped tasks; version requirements; add comments; transfer control |
| Agent | Start/get/cancel runs; answer input requests; stream events with a resume cursor |
| Workspace | Register/list/get immutable candidate versions and validation results |
| Workspace | Record review/approval/rejection; request application; retrieve application status/receipt |

Use authenticated HTTP commands and resumable server-sent events initially. Event
envelopes include event ID/sequence, task/run ID, time, type, and bounded payload.
Define status, progress, tool result, input request, candidate-ready, usage, and
terminal events. Reauthorize replay as well as live streaming. Use structured
errors for denied scope, stale control, budget exhaustion, interrupted execution,
invalid candidate, stale inputs, and provider failure. Internal service endpoints
require service authentication in addition to the initiating user's scope.

### Example: three developers on one workstream

1. Alice privately investigates password-reset behavior and selects findings to
   share. She creates “Add password-reset rate limiting,” defines acceptance
   criteria, previews its inputs, and starts a Coder run.
2. Bob sees the task and avoids duplicating it. He continues editing the reset
   response and posts a compatibility requirement to the task thread.
3. Conflux records his comment and marks Alice's run inputs as changed. The agent
   may finish its proposal, but that candidate is stale and cannot be applied.
4. Alice includes Bob's requirement, refreshes the inputs, and requests a revision.
   The new run and candidate retain links to the previous attempt.
5. Carol reviews the exact new diff and evidence. In the first milestone she can
   discuss or reject it; application controls are unavailable.
6. Once the application milestone exists, required checks run in isolation and
   an authorized human approves that exact candidate. Conflux conditionally
   applies it to current shared state or returns a stale/conflict result.
7. All clients receive accepted changes through collaboration sync. History
   identifies the agent run and approver without claiming Bob's existing edits.

### Delivery sequence and acceptance

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| 1 — Shared read-only proposals | One Coder/backend; scoped task/thread; owner/control; selected input manifest; persisted runs/events; Monaco candidate diff; cancellation and limits | Two users follow one task, contribute ordered feedback, reconnect without duplicate execution, and inspect a proposal without repository writes |
| 2 — Personal assistance and sharing | Private investigations, selected-context share preview, source-linked accepted decisions, basic overlap/changed-input warnings | Sharing exposes only selected context; another member cannot retrieve the private source; changed inputs visibly stale the proposal |
| 3 — Isolated implementation | Consistent capture, sandboxed execution, reproducible checks, durable background recovery | Closing the initiating desktop does not stop a server-hosted task; evidence identifies exact tested inputs and candidate |
| 4 — Reviewed application | Conditional collaboration application, approval versions, per-workstream application queue, durable receipts and recovery | Concurrent human edits or another application cannot be silently overwritten; retries cannot apply a candidate twice |
| 5 — Workstream intelligence | Source-linked questions/handoffs, targeted Reviewer/Security profiles, external adapters, selective parallel subtasks | Each capability improves measured team outcomes without leaking context or bypassing application policy |

Stage 1 should establish the data boundaries needed by personal mode; the UI need
not ship every mode at once. Do not delay read-only proposals for Git publication,
arbitrary terminal execution, multiple providers, autonomous task decomposition,
or a large agent-role catalog. Update the root architecture/TODO when stages are
accepted or implemented; this draft does not mark their checkboxes complete.

Validate access denial and revocation, private-to-shared leakage, prompt injection,
unsafe paths, contradictory comments, stale control, concurrent starts, budget
races, cancellation/completion races, provider failures, lost responses, event
replay, worker restart, stale evidence, and concurrent application. Native two-user
acceptance is required in addition to automated checks for shipped workflows.

Measure time to an accepted useful result, reviewer effort, cost per accepted
task, stale proposals detected, duplicate work avoided, recovery failures, and
reverts after application. Review measurement coverage; do not turn task/run
counts into individual contribution or performance scores.

### Decisions to finalize before implementation reaches them

- First provider/runtime, supported cancellation/recovery semantics, and pricing
  accounting; reconcile the runtime choice with the root architecture.
- Concrete capability names, approval rules, controller takeover, and bounded
  access revocation behavior.
- Persistence schema, artifact storage, retention/deletion, and provider data policy.
- Shared snapshot protocol before executable runs; the conditional multi-file
  application ADR before application is exposed.
- Sandbox deployment, credential/network policy, and supported file operations.

### Research informing the draft

These are external reference patterns, not proof that Conflux's design is already
implemented or that any multi-agent benchmark transfers to collaborative coding.

- [GitHub's agent workflow](https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-on-github)
  separates sessions and execution environments and describes shared monitoring
  and review. Conflux's proposed distinction is coordination with live shared edits.
- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
  validate candidates against a current target and preceding queued changes. The
  corresponding Conflux boundary must include uncommitted collaborative state.
- [Anthropic's multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system)
  describes coordination/cost tradeoffs and the difficulty of tightly dependent
  coding work. It supports selective parallelism rather than default fan-out.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  recommends simple, composable workflows and adding complexity when measured.
- [Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)
  and its [architecture](https://agentclientprotocol.com/get-started/architecture)
  provide an integration reference for agent sessions, updates, and permissions.

## Layout

```text
agent-service/
├── app/
│   ├── __init__.py
│   └── main.py
├── .python-version
├── pyproject.toml
├── uv.lock
└── README.md
```

See the [FastAPI documentation](https://fastapi.tiangolo.com/tutorial/first-steps/)
and [Conflux architecture](../../docs/architecture.md).
