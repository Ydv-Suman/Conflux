# How file history is stored today

This document describes the current implementation, including desktop recovery,
shared file versions, and backups. It does not propose a storage migration.

## Where the data lives

Shared history is stored on the **Collaboration Service's disk**. Each desktop
also stores its own document recovery state and pending version requests in
**local SQLite**. These serve different purposes.

| Data | Current location | Purpose |
| --- | --- | --- |
| Accepted document updates and attribution | Collaboration Service journal files | Authoritative shared document history |
| Saved file-version checkpoints | The same server journal files | Identify the fixed revisions shown in File history |
| Current document recovery state and unsynchronized edits | Each desktop's `conflux.sqlite3` | Recover local work and retry synchronization |
| Pending close/version requests | The same desktop SQLite database | Finish saving versions after reconnect or app restart |
| Repository source files | The selected local repository/worktree | Ordinary working files saved by the editor |
| Verified history backups | A separate server backup directory/volume | Restore journals after a failure |
| Live file indicators and cursors | Service/client memory only | Temporary collaboration presence; never saved as history |

The current implementation does **not** store shared file history in PostgreSQL
or upload it to an object-storage service. Docker volumes persist it on storage
managed by the Docker host. In production, that host would be the machine running
the Collaboration Service.

## Server storage paths

When running the service directly, its default data directory is:

```text
./.conflux/documents
```

This path is relative to the service process's working directory. Set
`COLLABORATION_DATA_DIR` to choose a different location.

The repository's Docker Compose configuration mounts:

| Docker volume | Path inside the collaboration container |
| --- | --- |
| `collaboration-data` | `/app/documents` |
| `collaboration-backups` | `/app/backups` |

Compose may prefix the actual volume names with its project name. Named volumes
survive ordinary container replacement; explicitly deleting those volumes deletes
their stored data. Their physical host paths depend on the Docker installation.

Each document's journal filename is derived from:

```text
document key = projectId/workstreamId/stableDocumentId
journal file = SHA-256(document key) + ".updates"
```

The stable document ID, rather than the visible filename, associates a file with
its history. A rename that preserves this ID preserves the history. Hashing the
filename does not encrypt the journal contents.

## What a journal contains

The current version 3 journal stores accepted Yjs updates and supporting records:

- The authenticated actor, server timestamp, and document update sequence.
- Original operation IDs, writer registrations, and retry information.
- Inserted/deleted ranges for validated attribution, where available.
- Periodic full Yjs snapshots used to reconstruct historical content.
- Close-file checkpoint metadata, including the creator, request ID, version
  number, fixed before/after sequences, content hash, and close boundary.

Imported content and older unverified records retain unknown authorship.

Versioned records contain serialized JSON inside a length-prefixed binary frame
with a CRC32C checksum. The service forces appended records to disk before
acknowledging their successful persistence. An exclusive directory lock permits
only one service writer for that data directory.

Full snapshots are retained on the first attributed update, import/migration
baselines, every 100th document sequence, and when the update tail reaches 1 MiB.
Other historical states are reconstructed from a preceding snapshot plus the
original incremental updates. This avoids storing a full document for every edit.

Storage snapshots and the user-visible saved versions are separate concepts.
Internal updates continue to be recorded for synchronization, recovery, and
attribution even though individual edits are no longer listed in File history.

## When a visible version is saved

1. A user opens a file and edits it. Recovery state is saved locally, and accepted
   updates are persisted by the server as synchronization proceeds.
2. When that changed editor tab is closed, the desktop flushes the local save,
   persists recovery state, and durably queues a close/version request before
   removing the tab.
3. The queue waits for the relevant updates to be accepted, then submits the
   checkpoint request to the Collaboration Service.
4. The server writes checkpoint metadata referencing a fixed historical boundary.
   File history uses that checkpoint to reconstruct the version and its diff.

Each open file has its own close boundary. Closing one file does not create a
version for every other open file. Typing, pasting, idle time, and autosave do not
independently create visible versions. An unchanged file or edits fully undone
before closing do not produce a new version; unchanged checkpoint content is
also deduplicated on the server.

If the file is closed while offline, the close request remains pending locally.
It becomes a shared version after the updates and request synchronize. A pending
operation ID, update hash, or accepted sequence preserves the original close
boundary even if the file is reopened and edited again.

A crash or app shutdown without a close request does not itself create a saved
version. Already persisted recovery data remains available separately.

## Desktop SQLite storage

The native desktop database is:

```text
<Tauri application data directory>/conflux.sqlite3
```

The application identifier is `com.conflux.desktop`. The exact application data
directory is resolved by Tauri for the operating system.

Document recovery and the version queue use the `document_state` table:

```sql
CREATE TABLE IF NOT EXISTS document_state (
    scope TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Each value is serialized JSON. Document recovery contains a base64 Yjs snapshot,
pending updates, readiness state, and available sequence/writer/registration
metadata. Its key includes the document WebSocket endpoint, team ID, and user ID.
The endpoint includes the service, project, workstream, and document identity.

The pending version queue has a separate key containing the collaboration service
URL, `file-checkpoints`, and user ID. Its jobs contain the project/team/workstream/
document scope, unique request ID, and close boundary. Recovery requires the
original account; the queue does not submit one user's pending work as another.

This database is **recovery storage, not a complete offline copy of every shared
historical version**. The History panel currently fetches version lists and diffs
from the Collaboration Service. A full offline history cache has not been
implemented. Local working files and Git commits are also separate from this
database and from shared file-history checkpoints.

## Backups and retention

By default, the service creates a verified compressed ZIP backup daily at
**02:00 UTC**. It includes committed document and file-tree journal data and a
SHA-256 manifest. It verifies the manifest and journal checksums before publishing
the completed archive.

Completed generated backups older than **30 days** are removed only after a new
backup succeeds; the newest verified archive is retained. This retention applies
to backup archives, not to live history. Canonical journals and checkpoints are
currently retained for the document's lifetime, including deleted files.

| Setting | Default |
| --- | --- |
| `COLLABORATION_BACKUP_ENABLED` | `true` |
| `COLLABORATION_BACKUP_DIR` | Sibling `backups` directory; `/app/backups` in Compose |
| `COLLABORATION_BACKUP_CRON` | `0 0 2 * * *`, evaluated in UTC |
| `COLLABORATION_BACKUP_RETENTION_DAYS` | `30` |
| `COLLABORATION_BACKUP_MAX_BYTES` | `2147483648` uncompressed bytes |

Backups contain source content and are not encrypted by the application. A
separate Docker volume on the same host does not protect against loss of that
host. Automatic copying to independent/off-host storage is not configured by this
implementation. Desktop SQLite recovery data is not included in server backups.

See [Document storage operations](../services/collaboration-service/STORAGE_OPERATIONS.md)
for verification, restore, upgrade, and rollback procedures.

## Current limits and access

- One Collaboration Service writer owns a data directory; shared storage and
  multi-instance realtime fanout are not implemented.
- Per-document limits remain 32 MiB of journal data and 10,000 records. Update/
  snapshot payloads are limited to 2 MiB. Compaction removes redundant snapshots,
  not original operations, and does not reset these limits.
- History API requests require current Identity permissions and exact Workspace
  scope. The UI does not establish access by knowing a journal filename.
- No automatic policy deletes canonical history. Disk capacity and independent
  backups remain deployment responsibilities.

## Implementation references

- [Server journal and checkpoint record format](../services/collaboration-service/src/main/java/com/conflux/collaborationservice/shared/DocumentJournal.java)
- [History API and historical reconstruction](../services/collaboration-service/src/main/java/com/conflux/collaborationservice/document/DocumentHistoryController.java)
- [Desktop close handling](../desktop/src/features/editor/CollaborativeEditor.tsx)
- [Durable pending-version queue](../desktop/src/features/history/useVersionQueue.ts)
- [Desktop document recovery format](../desktop/src/features/editor/documentStorage.ts)
- [Native SQLite database location](../desktop/src-tauri/src/storage.rs)
- [Native recovery table and writes](../desktop/src-tauri/src/document.rs)
- [Service storage and backup defaults](../services/collaboration-service/src/main/resources/application.yaml)
- [Docker volume mounts](../infra/docker-compose/docker-compose.yml)
