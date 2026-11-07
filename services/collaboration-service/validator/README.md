# Internal Yjs validation worker

This validator is used by the [version 2 document protocol](../ATTRIBUTION_PROTOCOL.md). `DocumentUpdateValidator` invokes it through stdin/stdout; no network
port is opened. Attributed WebSocket edits call it through the persistence store; legacy updates and the activity endpoint do not.

Uses pinned Yjs 13.6.33, matching the currently installed desktop library. The
lockfile pins transitive dependencies. Yjs performs decoding and CRDT integration;
this module checks the allowed text schema, struct identity, dependencies, and
effective insertion/deletion ranges.

## Local setup and checks

From this directory, with Node 22 or newer:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Then run `./mvnw test` from the parent collaboration-service directory. Java tests
exercise the real worker as well as crashes, timeouts, malformed responses, and
output limits. CI installs these dependencies before Maven. The Docker image
includes Node and this worker; no desktop checkout is needed at runtime.

## Internal contract

One JSON request per process, followed by EOF:

```json
{"baseline":"AAA=","update":"AQEKAAQBB2NvbnRlbnQFaGVsbG8A","writerId":10}
```

`baseline` and `update` are canonical base64 encodings of Yjs V1 updates.
`baseline` is the exact committed snapshot, including retained deleted content.
The caller must derive `writerId` from a durable binding for the authenticated
account and current document. It must never pass through an arbitrary client
writer ID. This worker performs no membership or binding lookup.

Success is `{ "ok": true, "result": ... }`, containing the tentative snapshot,
before/after text, `changed`, and inserted/deleted ranges. Each range has
`clientId`, `clock`, and `length` in Yjs UTF-16 clock units. Deleted ranges identify
the **target text**, not the deleting actor. The journal must associate the
accepted operation with the authenticated actor separately. Existing snapshot
structs and already effective deletions create no new ranges or credit.

Failure is `{ "ok": false, "code": "FOREIGN_WRITER" }` or another bounded error
code. Input content and exception stacks are not returned in errors. A validation
result is never a durable receipt. The future protocol must compare the base
version, atomically journal content and provenance, then acknowledge/broadcast.
Stateless evaluation ensures failed persistence cannot advance validator state.

## Supported scope and limits

- Only plain `Y.Text('content')` string structs, with no formatting, embeds,
  nested types, alternate roots, garbage-collected structs, or skipped structs.
  Unsupported history is rejected; it is never silently labeled as authored.
- Unicode text is supported, but edits that split a surrogate pair and silently
  replace previously accepted characters are rejected as `UNSUPPORTED_TEXT_SPLIT`.
- Baseline and attributable clients must retain deleted content (`gc: false`).
  Legacy snapshots may have discarded it and need the planned unknown/import
  path. New eligible desktop sessions use this protocol; legacy recovery stays on version 1.
- 2 MiB per binary input, 100,000 retained UTF-16 units including tombstones,
  and 10,000 decoded structs per input. These conservative validator limits do
  not change the legacy relay limits.
- Java allows two concurrent workers, a 256 MiB V8 heap per process, a five-second
  deadline, and at most 4 MiB of response data. Heap limits are not whole-process
  RSS limits; deployment memory must also account for JVM and native overhead.
- Java starts Node directly without a shell and strips `NODE_OPTIONS`/`NODE_PATH`.
  Run validation off the WebFlux event loop. Runtime paths are trusted deployment
  settings (`app.validator-node`, `app.validator-worker`), never request fields.
- The pinned decoder position and pending-store checks use Yjs implementation
  details. Upgrade Yjs only with the protocol and validator suites passing.

A fresh worker per request provides failure isolation but has startup and full
snapshot reconstruction costs. Measure latency/capacity before putting it on the
typing path; process pooling is deliberately not implemented yet.

This establishes which *new* structs match a server-supplied writer and which
deletions take effect. It cannot prove who physically typed content or distinguish
a copied deletion from an intentional deletion submitted by the same account.
The negotiated protocol must preserve original edit envelopes and classify
imports/recovery as unknown where provenance is unavailable. Durable writer
bindings and operation-ID receipts now exist in the internal
[attribution store](../ATTRIBUTION_JOURNAL.md), which supplies the authenticated
writer to this validator. Socket/desktop integration is implemented. Legacy import, reporting permissions,
and the history UI remain separate implementation steps.
