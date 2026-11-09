# Attributed document protocol (version 2)

Implemented on the existing document WebSocket endpoint. New desktop document
sessions offer version 2 for initial files up to 100,000 UTF-16 units. Existing
version 1 recovery records with pending edits and larger initial files retain legacy editing. Clean version 1 recovery can request an unknown-provenance import.
This protocol does not migrate historical authorship. The separate [edit dashboard](../../docs/contribution-attribution.md#implemented-edit-dashboard) now exposes scoped admin/lead reports and evidence.

## Negotiation and writer registration

Authenticate within five seconds using a text frame:

```json
{"teamId":"team-uuid","token":"access-token","acknowledgements":true,"protocol":2,"registrationId":"registration-uuid","migrateLegacy":true}
```

The backend verifies Identity membership and the exact Workspace relationship.
For an idle legacy journal, `migrateLegacy: true` requests a server reconstruction
and one atomic unknown-author baseline, retaining the original Yjs IDs and journal
records. Active legacy rooms remain version 1 until all participants leave.
Unsupported plain-text history/limits also remain version 1, with
`migrationBlocked: true` in the protocol response and an explanatory client status.
Migration never changes old submitters into verified authors.
For a new or already attributed document, it replies:

```json
{"type":"protocol","version":2,"initialOperationId":"initial-seed-operation-if-present"}
{"type":"writer","requestId":"registration-uuid","writerId":12345}
```

`initialOperationId` is omitted when no baseline has been committed. Writer IDs
are allocated by the server, durably bound to this document/account, and retried
idempotently by registration UUID. Another account cannot publish with that
writer, even if it knows the number. The same registration UUID is reused across
connection retries in one editor instance; a newly opened instance registers a
new writer for new edits. Previously persisted edits keep their original writer.

An attributed document rejects legacy-only clients. A desktop with attributed
recovery state rejects a legacy response instead of discarding provenance.
No credentials appear in URLs or update envelopes.

## Replay and first baseline

After writer registration, the server replays accepted update bytes as binary
frames and sends `{"type":"synced"}`. For a new document, exactly one participant
receives `{"type":"initialize"}` instead. That participant inserts its existing
file text under the allocated writer and sends:

```json
{"type":"seed","operationId":"operation-uuid","writerId":12345,"update":"base64-yjs-update"}
```

The seed is validated and committed atomically as an **unknown-author import**:
the initializer is its submitter, but receives no insertion/deletion credit for
the pre-existing file. The server broadcasts the bytes and `synced` only after
persistence. Empty files use a real empty Yjs update. A new seed operation is
rejected after initialization; exact retries return the original receipt.

If an uncommitted seed loses initialization to another participant, its desktop
detects a different `initialOperationId` on reconnect and stops with the local
text preserved. It does not merge two independent baselines and duplicate text.
That exceptional case needs explicit reconciliation/reopening after preserving
the local copy.

## New edits and durable receipts

After synchronization, send local incremental updates:

```json
{"type":"edit","operationId":"operation-uuid","writerId":12345,"update":"base64-yjs-update"}
```

The server reauthorizes each attributed message, verifies actor/writer ownership,
validates new structs and effective deletions, and journals the result before
broadcasting to other participants. The sender receives:

```json
{"type":"ack","sha256":"sha256-of-exact-decoded-update","sequence":2,"operationId":"operation-uuid","writerId":12345}
```

Receipts are always enabled in version 2. A retry must preserve operation UUID,
writer, kind, and exact bytes. Changed content/kind/writer under an existing ID is
rejected. An exact retry returns the original sequence and does not rebroadcast.
Equivalent snapshot content under a different operation produces no new effect
ranges. Counts of journal entries are not contribution scores.

## Desktop recovery

`StoredDocument` version 2 stores the Yjs snapshot, ready state, current writer
metadata, and pending envelopes (operation UUID, writer, seed/edit kind, base64
update, SHA-256) together in the existing SQLite record. An envelope is persisted
before transmission. It is removed only after a receipt matches its operation,
writer, and hash. Unknown/mismatched receipts cannot clear pending work.

Yjs garbage collection is disabled so validator-required deleted content remains
available. On reconnect, replay server updates and retry exact pending envelopes;
do not manufacture a new full-snapshot authorship claim. On reopening, retain old
envelopes and allocate a new writer before allowing new edits. Existing ready
content can be recovered locally while the editor waits for its new binding.

Version 1 recovery records remain readable. With no pending writes, the desktop
offers version 2 plus `migrateLegacy: true` on reconnect/reopen and disables editing
until negotiation completes. Existing snapshot IDs are retained; only future
updates use the newly bound writer. Pending version 1 updates are never relabeled.
If the server already migrated, close code `4410` preserves that recovery state
and asks the user to save a local copy and reconcile it with the shared file.
Close/reopen alone does not discard pending recovery; it must be resolved explicitly.
Version 2 records are never silently downgraded. Native SQLite needs no table migration because the payload is already
an opaque JSON value scoped to endpoint, team, and account.

## Limits, deployment, and validation

Deploy the updated Collaboration Service (including its Node validator runtime)
before clients start creating version 2 documents. The current 2 MiB WebSocket
frame limit includes the JSON/base64 envelope, and the validator's smaller
plain-text/retained-history limits also apply. Validation, journal, dependency,
or resource failures never generate a success receipt. The desktop retains local
pending work; access denials stop automatic retries. Protocol rejection uses
`1008`, revoked access uses `4403`, and transient service failure uses `1013`.

Eligible idle legacy histories migrate on clean modern-client negotiation. For an
active legacy room, wait for all participants to finish synchronization and close
the file, then reopen it. Unsupported histories retain legacy editing. Older server binaries cannot read version 2 journal files;
see [journal recovery and rollback constraints](ATTRIBUTION_JOURNAL.md).

Backend integration tests execute the real desktop connection against a running
Java WebSocket server, with two dummy authenticated accounts, concurrent edits,
offline/reopened recovery, and deletions. Install both `validator` and `desktop`
npm dependencies before `./mvnw test`. Desktop tests additionally cover lost
receipts, mismatch rejection, persistence-before-send, downgrade refusal, and
competing initial baselines. CI installs both dependency sets.

Manual native-desktop validation and sustained-load profiling remain to be done.
Ordinary shared history APIs/UI, self-records, and corrections are not part of this
protocol change.

## Optional close-checkpoint boundaries

Desktop handshakes add `"checkpoints": true` independently of attribution protocol
selection. For those clients, the final `synced` control includes the committed
`sequence`, and each subsequent peer binary update is preceded by
`{"type":"revision","sequence":N}`. The binary update and sequence are persisted
together in local recovery. Own acknowledgements advance the saved accepted
sequence only after their matching pending edit is durably cleared. Legacy clients
without this flag retain their original frames. These revision controls describe
recovery boundaries, not visible versions.

Closing a changed tab persists a separate request UUID with the final pending
operation ID (or legacy update SHA-256), or its exact accepted sequence when all
updates are acknowledged. After synchronization, `POST .../history` publishes a
fixed close checkpoint. Time passing, autosave, and individual updates never create
visible versions. Close requests require current edit access, and history reads
retain their separate read authorization. Repeated or concurrent closes of the
same content have stable no-change receipts without duplicate versions.
