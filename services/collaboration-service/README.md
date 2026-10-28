# Collaboration Service

Authenticated, durable binary document relay for one shared team workstream. Identity owns membership and capabilities; Workspace owns the project/team/workstream relationship. This service does not create memberships, modify repository files, or publish Git commits.

## Run

Java 25. Start Identity and Workspace first, then run `./mvnw spring-boot:run` from this directory.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `IDENTITY_API_URL` | `http://localhost:8080` | Trusted Identity API |
| `WORKSPACE_API_URL` | `http://localhost:9000` | Trusted Workspace API |
| `COLLABORATION_DATA_DIR` | `./.conflux/documents` | Durable document journals; relative to the working directory |

Keep the data directory on a persistent volume, restricted to the service user, and back it up. Run **one service instance** against this directory; an exclusive file lock prevents concurrent writers. Use HTTPS/WSS outside local development, including service-to-service calls when they cross an untrusted network. These URLs are deployment configuration, never client input.

## WebSocket protocol

`/ws/projects/{projectId}/workstreams/{workstreamId}/documents/{documentId}`

Project and workstream IDs are UUIDs. Document IDs allow 1–128 ASCII letters, digits, `.`, `_`, and `-`. Query strings are rejected; tokens must not appear in URLs.

1. Within five seconds of opening the socket, send a **text** frame:

   ```json
   { "teamId": "team-uuid", "token": "identity-access-token" }
   ```

2. The server forwards the bearer token to Identity's `GET /api/teams/{teamId}/capabilities/me` and Workspace's `GET /api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}`, using API version `1.0`. Both services validate authentication. Identity supplies the actor ID; the client cannot nominate an author. The member must have `JOIN_WORKSTREAM` and `EDIT_DOCUMENT`, the exact project/team/workstream must match, and the repository must be initialized and not merged or archived. No document history is exposed before these checks pass.
3. For an existing document, apply every binary history frame to the same Y.Doc, in order. The text frame `{"type":"synced"}` marks the end of replay.
4. For an empty document, **one participant only** receives `{"type":"initialize"}`. That participant seeds its Y.Doc from the agreed local file and sends one binary `Y.encodeStateAsUpdate(doc)` (also for an empty file). Other participants wait. After the update is durable, the server forwards it to the waiting participants and sends `synced` to everyone. If the initializer leaves or fails to initialize within roughly 10–15 seconds, another waiting participant is selected. This prevents duplicate initial text on concurrent first opens.
5. After `synced`, send binary Yjs updates. Do not echo received updates. The server serializes updates within the room, writes and forces each new record to disk, then broadcasts to the other participants. It does not send an acknowledgement for each edit; retain local state for recovery.
6. On reconnect, keep the existing Y.Doc, authenticate again, apply replayed history with a remote origin, then send `Y.encodeStateAsUpdate(doc)` after `synced` to recover offline or unacknowledged edits. Yjs merges repeated operations. Identical binary retries are omitted from the journal. Never independently reinsert disk contents when replayed document text is empty: a user may intentionally have deleted all text.

Permissions and token validity are checked again every five seconds (dependency requests time out after three seconds). Changes can therefore take up to about eight seconds to stop an existing connection. Outages fail closed. The desktop should use backoff for transient failures, refresh authentication once for `4401`, and stop automatic retries for `4403`.

| Close code | Meaning |
| --- | --- |
| `4401` | Missing, invalid, or expired authentication |
| `4403` | Membership, editing permission, or workspace access denied |
| `1008` | Invalid protocol, room URL, or initialization timeout |
| `1009` | Transport message exceeds the size limit |
| `1013` | Dependency/storage unavailable or capacity reached; preserve local state |

**Desktop integration is pending.** The previous desktop sends unauthenticated binary frames and expects an empty binary replay marker. It must adopt this protocol before using this backend version. There is deliberately no anonymous compatibility mode.

## Contributor activity

`GET /api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}/documents/{documentId}/activity?limit=10&before=123`

Requires the same access checks and an `Authorization: Bearer ...` header. `limit` is 1–100 (default 10); omit `before` for the latest page. Results are newest first:

```json
{
  "items": [{ "sequence": 122, "actorId": "user-uuid", "timestamp": "2026-10-26T12:00:00Z" }],
  "nextBefore": 122
}
```

`nextBefore` is null when no older page exists. Activity never returns document bytes or tokens. Entries identify **who submitted an update**, including initialization and reconnect snapshots. They are not line-level authorship or proof of task ownership: a reconnect snapshot can contain changes originally made by other users. Those need a separate CRDT-aware attribution/task workflow.

## Persistence and bounds

Each document has a hashed filename containing an append journal of actor UUID, timestamp, update bytes, and checksum. Record order supplies a stable sequence. Complete records survive service restarts. An incomplete final record is truncated on load; a checksum mismatch fails closed instead of silently discarding history. No existing Git or desktop files are changed.

Limits: 2 MiB per message, 32 MiB or 10,000 records per document, 32 active rooms, 32 participants per room, and 64 queued messages / 4 MiB per participant. Slow clients are disconnected; empty rooms are evicted from memory. On reaching a document history limit, updates are rejected without deleting earlier edits. Storage failures disconnect the affected room so its next session reloads durable history.

This is a bounded single-instance implementation. CRDT compaction, aggregate disk quotas, multi-instance fanout/shared storage, per-line attribution, Git checkpoint coordination, and automatic desktop reconnect are not implemented here. Binary Yjs payloads are opaque to the server; semantic validation and convergence belong to compatible clients. Backend tests exercise simultaneous relay, access checks and revocation, replay, initialization handoff, attribution, and journal recovery; a two-desktop Yjs convergence test remains part of the desktop update.

Run backend checks with `./mvnw test`.

## Package layout

```text
com.conflux.collaborationservice
├── CollaborationServiceApplication
├── config      # WebSocket routing and transport configuration
├── document    # Document relay and contributor activity
├── filetree    # File/folder operations, state, and synchronization
└── shared      # Authorization, document identifiers, and durable journals
```

Tests mirror the feature packages. Their shared WebSocket client lives under
`src/test/java/com/conflux/collaborationservice/shared`.

## File and folder synchronization

The backend also provides `/ws/projects/{projectId}/workstreams/{workstreamId}/files`
for authenticated creation, rename/move, and deletion of files and folders.
Folder operations apply to the whole subtree. Version checks prevent stale changes
from overwriting newer ones; operation IDs make retries idempotent. Accepted events
are persisted before broadcast and replayed after reconnecting.

See [the file-tree protocol](FILE_TREE_PROTOCOL.md) for message formats, initialization,
stable document IDs, limits, and desktop integration requirements. The desktop
watcher and Explorer are not connected to this channel yet.
