# Contribution attribution protocol design

Status: partially implemented contract, 2026-11-06. The validator, durable writer
bindings, and versioned edit/provenance records are implemented internally. No new
reporting permission or UI is enabled. Negotiated version 2 editing and desktop
recovery are implemented for eligible new documents. The legacy binary relay
remains compatible for legacy journals. This work is part of
the [attribution milestone](architecture.md#contribution-attribution-and-ownership-planned).

Implementation progress: the [internal Yjs validator](../services/collaboration-service/validator/README.md)
and Java process boundary are implemented and tested for bounded plain-text
updates. The [attribution journal](../services/collaboration-service/ATTRIBUTION_JOURNAL.md)
adds authenticated registration and submission, durable bindings, atomic edit
provenance, and stable internal receipts across restart. These are enabled through the [version 2 protocol](../services/collaboration-service/ATTRIBUTION_PROTOCOL.md)
and desktop pending-envelope storage. Initial file contents are marked unknown;
legacy-history imports, reporting permissions, and history UI remain pending.

## What attribution means

Record the authenticated account responsible for submitting a validated new edit
under a server-bound writer identity. This is account-level provenance, not proof
of who physically typed text, its intellectual origin, or its business value.
Pasted/generated text is not automatically human-authored work. A snapshot
submitter, task owner, checkpoint creator, and reviewer are separate identities.

Never promote current journal `actorId` values into original authors. They identify
submitters of opaque payloads only. Initialization, imports, pre-upgrade pending
updates, and unverified external content retain unknown original authorship.

## Findings from the installed Yjs implementation

The executable checks in
`services/collaboration-service/protocol-checks/attribution.test.cjs` demonstrate:

- A snapshot contains structs from multiple writers. Its hash differs from the
  original incremental updates even when it introduces no new content on replay.
- Struct identity is `(client ID, clock range)`, not a line number or payload hash.
- A deletion-only update contains target IDs, not the deleting user's identity.
  It can change content without advancing the Yjs state vector.
- Transaction `origin` is local metadata, not authenticated wire provenance.
- A client can choose its Yjs client ID; an ID or collaborative user map alone
  cannot prove authorship.

Run from the repository root after installing desktop dependencies:

```sh
node --test services/collaboration-service/protocol-checks/attribution.test.cjs
```

These checks validate protocol assumptions only. They are not acceptance tests
for an attribution implementation.

## Proposed protocol boundary

Use an explicitly negotiated new protocol version on the existing document
socket. Keep legacy binary clients on submitter-only provenance. Do not silently
reinterpret old bytes or enable a new server mode for an old desktop.

All operations are scoped to the authorized team, project, workstream, and stable
document ID. The backend derives the actor from Identity and validates the
Workspace relationship. No operation accepts an authoritative `authorId` from
the client.

### Writer registration

After authentication, the server allocates a writer ID and binds it durably to
the actor and document. This ID maps to a Yjs client ID but is not itself a secret
or authorization token. Never transfer a binding to another account or document.
The desktop must use it before producing attributable local edits.

Reopening a document should allocate a new writer for new edits, while retaining
old writer IDs and exact envelopes for pending edits. Concurrent windows must
not produce overlapping clocks under the same writer. Account switching cannot
submit another account's pending work or rebind its writer. Token renewal is
allowed only for the same actor. Revoked users cannot publish offline work.

Editing before a binding exists may remain locally available, but must not later
be relabeled as verified work without a validated provenance path.

### Edit submission

A versioned envelope contains an operation UUID, writer ID, exact Yjs update
bytes, and any required dependency/version references. The server computes the
payload hash and acceptance timestamp. Client timestamps are optional claims,
never the authoritative ordering or time worked.

Before accepting an attributed edit, a trusted Yjs-aware validator must:

1. Decode and bound the payload, allowing only supported document types/content.
2. Verify that every new struct belongs to the bound writer and expected clock
   progression; reject foreign unseen structs and conflicting content for an
   existing struct identity. Known overlapping structs preserve prior provenance.
3. Validate deletion targets against known document state. Attribute an accepted
   deletion operation to its authenticated actor, never the target's author.
4. Reject missing dependencies without a success receipt; retain the desktop's
   pending envelope for resynchronization. Do not accept unbounded pending structs.
5. Determine whether the operation changes document state. Pure replay cannot
   create a new contribution. Concurrent requests to delete the same content may
   record attempts, but cannot claim multiple effective deletions.

Idempotency is scoped to document, actor, and operation UUID. Retrying the same
UUID and bytes returns the original receipt; changing its payload is rejected.
Semantic overlap under a different UUID or encoding is still checked by the
validator. An operation count is not a productivity score.

### Snapshot and recovery

Recovery replays accepted history and retries the original pending envelopes.
A snapshot is a transport/reconstruction artifact, never a new authorship claim.
Known structs retain existing attribution. Unseen structs in an import/recovery
snapshot remain unknown unless validated original envelopes establish provenance.

Keep deletion operation provenance separately from the accumulated Yjs delete
set, which cannot identify the deleting actor. Do not use only a state vector as
a history version. Use the durable document sequence, which includes deletions,
plus the immutable document identity.

Undo/redo creates a new authenticated operation referencing the original action
when known. It does not rewrite the earlier history or automatically earn a
second unit of contribution. Shared credit is an explicit audited annotation,
not inferred from who was online.

## Persistence and receipts

The initial implementation is documented in the [journal format and recovery contract](../services/collaboration-service/ATTRIBUTION_JOURNAL.md).
It implements binding and accepted-edit records; correction records and legacy
import are still planned. The requirements below also cover those later stages.

Extend the document journal with versioned records that atomically contain the
accepted update and its provenance. Do not write content and author metadata to
independent files without transactional recovery.

Proposed record types:

| Record | Required evidence |
| --- | --- |
| Writer binding | Scope, writer ID, authenticated actor, server creation time |
| Accepted edit | Sequence, operation UUID, actor, writer, payload/hash, validated new struct ranges and deletion effects, provenance status, server acceptance time |
| Import/legacy update | Sequence, payload/hash, submitter if known, original authorship unknown |
| Correction | Original record reference, requested/resolved identities, reason, evidence, server times; append without overwriting the original |

Persist and force the record before acknowledgement or broadcast. On storage
failure, do not acknowledge or expose a new accepted version. A validator's
tentative state must roll back or be rebuilt from the last durable journal point.
Crash recovery rebuilds bindings, versions, logical deduplication, and provenance
from committed records. Incomplete tail recovery and corruption handling must
retain the current journal's fail-closed behavior.

Old records remain readable with unknown original authorship. Use a versioned
format with an explicit marker, not heuristics over old update bytes. Define
backup and rollback behavior before enabling writes that an old server cannot
read. Preserve original records until migration and replay are verified.

The desktop stores each pending envelope atomically with its recovery snapshot,
under its existing document/team/account scope. An acknowledgement must match
document, operation ID, and hash before removing that envelope. Lost responses,
restarts, and token refresh cannot create new operation IDs for the same edit.

## File history and permissions

Ordinary document history is implemented with bounded sequence pagination, exact
version references, read-only before/after diffs, provenance status, and explicit
unknowns. Open a shared file and click the File history clock icon beside the editor tabs. A rename
keeps the stable document ID. Deletion retains history subject to access and
retention policy; recreating a path is not automatically the same document.

Visible history consists only of durable close-file checkpoints. Typing, pasting,
autosave, idle time, and an unclosed editing session produce no visible version.
The desktop compares each file with its own opening baseline and persists a close
request before removing a changed tab. Unchanged files and net-undone edits do
not request a version. Shared identical content is deduplicated on the backend;
request IDs make retry receipts stable after restart. Offline close boundaries
use the last pending operation/hash or the exact saved accepted sequence, so a
later reopening cannot extend an earlier close's version. Pending requests retry
in the background after document synchronization, scoped to the original account.

The creator is the authenticated member who closed the file; contributors are
computed independently from the accepted updates in the saved range. Legacy
changes remain unknown-authorship. No manual-version button or individual-edit
view is exposed. Raw updates and no-effect receipts remain durable for recovery
and attribution; storage snapshots are not visible versions.

Implement separate centrally managed capabilities for team reports and
correction resolution, granted only to admins/team leads in scope. Members can
view their own records and request corrections; their identity comes from the
authenticated subject. Shared debugging history requires document access and
does not include restricted member analytics. Operational session leadership
does not grant reporting access.

Backend checks apply to every request, pagination, direct link, and future
export. A reporting capability never bypasses team/project/workstream access.
Test demotion, membership removal, unavailable authorization services, and cache
invalidation. Decide a bounded revocation interval before adding subscriptions.

No reporting totals are released until attribution coverage and deduplication
are demonstrated. Unknown work is not zero work. Attribution cannot establish
regression causation or justify an automatic employment recommendation.

## Implementation gate and order

The Java service now has a stateless internal validator using pinned Yjs in a
bounded Node worker. Tests cover overlapping structs, deletions, malformed inputs,
writer mismatch, resource failures, and deterministic replay. It is used for negotiated version 2 sessions. Adding an author field or using `PermanentUserData` on an untrusted
client remains insufficient. Measure sustained worker latency before broad deployment; legacy histories
remain on version 1 until their import path is implemented; supported content and process limits
are documented in the validator README.

Then implement, in order:

1. Trusted validation and adversarial fixtures using real desktop Yjs payloads.
2. Versioned journal records, writer bindings, atomic receipts, and restart replay.
3. Negotiated socket protocol and desktop pending-envelope persistence.
4. Shared history/access rules and file-history UI are implemented; member self-records and audited corrections follow.
5. Full acceptance checks, followed by cursors and shared checkpoints. Add report
   aggregates only when their source task/review/checkpoint workflows exist.

## Required acceptance scenarios

- Alice and Bob edit concurrently/offline; Bob's snapshot cannot acquire Alice's
  authorship. Both clients and the service restart without loss of evidence.
- A member submits another writer's unseen structs or spoofs author metadata:
  reject the attribution attempt without modifying durable content/history.
- Same operation/exact bytes, changed bytes under one ID, and alternate encodings
  of the same structs all receive the specified deduplication/conflict behavior.
- Deletion-only edits, duplicate/concurrent deletes, undo/redo, missing dependencies,
  and account changes cannot silently misattribute work.
- Failure between validation, journal force, broadcast, and receipt neither loses
  accepted edits nor reports uncommitted provenance as durable.
- Legacy/imported data remains unknown; migration preserves content and receipts.
- Cross-team reports, other-member self-history queries, direct restricted URLs,
  demotion, and revocation are denied; authorized shared debugging still works.
- Corrections preserve the original assertion, actor, reason, and evidence.

The first four executable checks above establish why these scenarios are needed.
They do not satisfy this acceptance list on their own.

## Implemented edit dashboard

The desktop exposes **Workstream → Contributions** for admins/team leads. The
Collaboration service checks current Identity membership, ADMIN/TEAM_LEAD role,
VIEW_PROJECT capability, and exact Workspace project/team/workstream scope on
both report and evidence requests. A member filter is a reporting filter, never
an authorization grant. Responses use `Cache-Control: no-store`.

- `GET /api/projects/{project}/teams/{team}/workstreams/{stream}/contributions?from=<instant>&until=<instant>&actorId=<optional UUID>&documentId=<optional ID>&offset=0`
- `GET /api/projects/{project}/teams/{team}/workstreams/{stream}/contributions/documents/{document}/changes/{sequence}`

The first endpoint counts effective, non-imported version 2 operations, inserted
and deleted UTF-16 units, and affected files. Logical retries/no-effect updates
are excluded. It returns coverage for legacy history, imports, and files without
records, per-account unverified submission counts, and independent pages of 100
source changes and daily file/account groups. Daily totals are computed before
pagination. `allTime=true` omits the date bounds; custom windows are at most 366 days,
start-inclusive/end-exclusive by server receipt time. Scans above 100,000 document
records fail rather than return incomplete totals; filtering by file reduces the
scan. The second endpoint returns before/after Yjs snapshots for an attributable
operation; it does not accept a client-provided account attribution.

The file-tree journal supplies the catalog, including deleted files and latest
recorded paths. Documents outside that catalog are not covered. Reads across
files are not a checkpoint and concurrent edits can shift pages. Unknown records
are excluded, not credited to the importing/submitting account. Per-account
edits do not establish original human authorship, ownership, quality, or causation.

The desktop retains expanded details during successful refreshes, clears data on failures, and reloads every 30 seconds
while active and on focus, and discards the view on scope changes. Background
browser throttling can delay timer-based clearing; backend checks are per request.
Self-records, correction audit, broader workflow measures, and native/load
validation remain pending. No productivity score or automated employment decision
is produced.

## Legacy-file migration

Modern clients with no pending legacy updates request `migrateLegacy: true` during
version 2 negotiation. An idle room reconstructs only the server’s durable journal,
then appends one imported baseline with reserved `importedWriters`. Existing bytes,
Yjs identities, deletions, and sequence references remain intact. Historical
submitters stay unverified; future bound-writer operations contribute normally.
Active rooms defer migration. Unsupported or oversized histories remain in legacy
mode with a client status message. Validation/persistence failures never erase the
original journal or acknowledge migration success prematurely.

A version 1 device with pending edits stays on legacy negotiation. If another
client already migrated the file, close code 4410 leaves the local snapshot and
outbox intact and asks for a local copy and manual reconciliation. There is no
automatic conversion of offline legacy edits into attributed work.
