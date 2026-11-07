# Durable attribution foundation

Implemented and connected through the [version 2 protocol](ATTRIBUTION_PROTOCOL.md)
for eligible new desktop documents. This foundation adds authenticated writer registration, atomic edit/provenance persistence,
and restart-safe retries. The separate [edit dashboard](../../docs/contribution-attribution.md#implemented-edit-dashboard) reads these records for restricted admin/lead reports and evidence; ordinary shared history UI remains planned.

## Internal flow

`DocumentAttributionService` accepts document scope and credentials, derives the
actor through `DocumentAuthorization`, and runs blocking work off the WebFlux
event loop. Every registration and edit attempt, including a receipt retry,
requires fresh authorization. The version 2 socket handler performs the same
authorization before calling the store and serializes publication within its
room. There is no client-controlled author parameter.

`AttributedDocumentStore.register` creates a random JavaScript-safe writer ID,
scoped to the document and actor. A repeated `(actor, registration UUID)` returns
the original durable binding, including after restart. A writer cannot be
reassigned; another window registers a new writer. Reserved internal file-tree
IDs are not accepted as document scopes.

Submission verifies the actor owns the writer, then validates the update against
the last committed snapshot. Validation runs outside the journal lock. At commit,
the store rechecks the binding, operation retry, and document sequence. Concurrent
changes produce `StaleVersion`; the caller must retry the same operation UUID and
bytes against the new state. Concurrent exact retries return the original entry.

The returned entry is available only after the complete record is written and
forced to disk. The first record also forces the parent directory entry. There
is no broadcast in this persistence layer. The version 2 relay acknowledges and
broadcasts only after this method succeeds.

## Identities and retries

- An operation UUID is scoped to document and authenticated actor. Reusing it
  with different bytes or a different writer is rejected.
- Exact retries preserve the original sequence, server acceptance time, update,
  and attribution. They append no record.
- A differently encoded snapshot or new operation UUID is validated semantically.
  Known structs and existing deletions contribute no new ranges. A no-effect
  operation still has a durable receipt but empty effect ranges; record counts
  must never be presented as contribution totals.
- In a mixed snapshot, Alice's known ranges stay with Alice's earlier entry;
  Bob's entry records only newly accepted ranges under Bob's bound writer.
- Deletion ranges identify the target text. The deleting account is the entry's
  actor, not the target range's writer.
- `VALIDATED_ACCOUNT_EDIT` describes the newly accepted effects and account-level
  provenance. Initial `seed` records have `imported: true`, unknown authorship,
  and empty effect ranges. It does not certify physical typing, pasted text's origin, or the
  authorship of all text in the submitted payload.

## On-disk format and recovery

Both record types live in the existing document `.updates` file. The directory
still has a single-instance writer lock.

| Format | Framing | Body |
| --- | --- | --- |
| Legacy | Positive signed 32-bit byte length, body, CRC32C | Actor UUID, server epoch milliseconds, opaque update |
| Version 2 | Negative signed 32-bit byte length, body, CRC32C | JSON with `version: 2` and exactly one binding or edit |

Version 2 bindings store actor, registration UUID, writer ID, and server time.
Version 2 edits store document sequence, actor, server time, exact update bytes,
operation UUID, writer ID, resulting snapshot, and effective insertion/deletion
ranges **in the same record**. Byte arrays use JSON base64 encoding. No separate
metadata file can become inconsistent with its document update.

Replay rebuilds writer bindings and operation receipts and restores the last
snapshot. Sequences count edit entries, not writer registrations. An incomplete
final record is truncated; a complete record with a checksum, schema, binding,
or identity conflict fails closed. Update/snapshot arrays returned to callers
are copied so callers cannot mutate durable evidence.

Existing legacy records remain readable and have `authorshipStatus() == UNKNOWN`.
The old activity endpoint retains its submitter-only response. A clean modern
client can request `migrateLegacy: true`. When no room is active, the server
reconstructs the durable legacy updates with pinned Yjs, validates supported
plain-text structure and limits, then appends one imported baseline. Original
journal bytes, sequence references, text IDs, and deletion state are preserved.
The baseline's `importedWriters` list reserves historical client IDs so new
bindings cannot claim them. It has no insertion/deletion credit and requires no
intermediate binding record: a failed append cannot leave a half-migrated file.
Old records stay unknown; new writer-bound edits receive attribution normally.

Registration without this import still raises `LegacyHistory`. Malformed or
unsupported history leaves the journal unchanged and the relay in legacy mode.
Existing deleted-text tombstones may be retained in imported baselines; clients
cannot create new tombstones as attributed insertions. No historical authorship
is inferred from submitter IDs.

Once a version 2 binding or imported baseline exists, legacy append calls reject writes to that
document. This prevents old clients from bypassing attribution. Old server
binaries reject the negative length marker and must not be used with version 2
files. Back up the data before enabling the new protocol; there is no downgrade
migration. Rollback to an earlier backup would discard later accepted work and
must never happen automatically.

## Bounds and remaining work

The existing 32 MiB per-document journal and 10,000-record limits include bindings,
snapshots, and no-effect receipts. Each version 2 body is limited to 8 MiB; binary
updates and snapshots remain limited to 2 MiB each. Limit failures return no
receipt and do not delete accepted history. The initial implementation stores a
snapshot per edit and replays the bounded journal on requests; storage growth and
latency must be measured before enabling sustained collaborative editing.

Socket envelopes and desktop writer/pending-envelope persistence are implemented.
Legacy import and restricted edit reporting are implemented. Self-records, audited
corrections, ordinary shared-history UI, and sustained-load validation remain pending.

Tests cover real Yjs two-writer snapshots, deletion replay, restarts, stable
receipts, writer spoofing, cross-document rejection, legacy compatibility,
corruption/incomplete tails, failed persistence, concurrent stale validation,
mutable input/output buffers, and authorization revocation. Run `./mvnw test`
after installing the validator dependencies as described in its README.
