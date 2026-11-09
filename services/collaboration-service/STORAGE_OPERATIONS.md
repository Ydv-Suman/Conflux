# Document storage operations

## Persistence and history

Version 3 keeps every accepted update, original operation ID, actor, timestamp,
writer binding, and inserted/deleted range. It stores a full snapshot on the
first edit, import/migration baselines, every 100th document sequence, and when
the update tail reaches 1 MiB. Intermediate snapshots are reconstructed from
the closest full snapshot plus the original incremental updates. CRDT garbage
collection is deliberately disabled: deleted structures still support audit and
offline recovery. This is storage compaction, not deletion of attribution.

Version 1/2 files remain readable. The next versioned write atomically compacts
old version 2 snapshots. The replacement is forced to disk, atomically renamed,
and its directory forced before the next append can be acknowledged. A failed
replacement leaves the original journal intact; an interrupted temporary file is
never used for recovery. Legacy version 1 record bytes are preserved exactly.

Journal reads use a 64 MiB, at-most-32-document cache, invalidated by file identity,
size, or modification time. It is disposable, never the source of truth. Only the
service may write to its private data directory. Historical snapshots can be
reconstructed after restart without this cache. Close-checkpoint metadata uses a
separate bounded index (32 documents / 100,000 consumed entries), updated only
for appended entries. A cold index rebuilds from the checksummed journal;
warm pages use a sequence-ordered map. Every API request still reauthorizes
before accessing either index.

History shows only explicit close-file checkpoints and their fixed range diffs.
Typing, idle time, and autosave do not create versions. Each changed tab is
independent; unchanged content is deduplicated across collaborators. The creator
is displayed separately from contributors. There is no manual-version button or
individual-edit mode. The clock icon opens History. Restricted contribution
evidence still uses original operation references independently.

Checkpoint requests and no-change receipts are checksummed version 3 journal
records alongside updates/bindings, without advancing the document update
sequence. They retain their authenticated creator, request UUID, fixed before/after
sequences, visible version number, content hash, and original close boundary.
These records are included automatically in backups. Legacy documents remain on
the legacy protocol after close records; a checkpoint does not imply attribution.
New checkpoints extend the version 3 schema, so older binaries still require the
matching backup for rollback.

The desktop keeps pending requests in native SQLite under account/service scope.
It saves recovery before removing a tab and waits for durable update receipts
before posting the request. A pending operation ID/hash or saved accepted sequence
anchors each close, preserving multiple offline closes across restart/reopening.
Failures keep requests durable and visible for retry. Crashes without a close
request do not create versions. Previously time-grouped updates were not durable
versions and are no longer presented as versions; the underlying audit is retained.

## Retention and backups

Canonical live journals, writer registrations, and retry receipts are retained
for the document's lifetime, including deleted files. Nothing in the daily
retention job deletes these records or silently replaces unknown authorship.
Deleting canonical records needs a separate product retention policy and a
receipt-compatible archival design.

The service creates a compressed ZIP backup daily at **02:00 UTC**, containing all
document and file-tree journals plus a SHA-256 manifest. File descriptors capture
one committed cut under the journal lock; copying and compression occur outside
the lock. Descriptors pin the original inode if compaction replaces a file during
the backup. Only the captured committed prefixes are included.

Every archive is verified against its manifest and every journal record checksum
before atomic publication. The backup file and directory entry are forced to
disk. Incomplete or corrupt input cannot produce a completed archive. Only after
a new backup verifies are generated archives older than 30 days removed. The
newest verified backup is always retained. Unknown files and unfinished archives
are never treated as valid backups. Failed backups are logged as errors and do
not discard previous recovery copies. Monitor these logs and archive age.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `COLLABORATION_BACKUP_ENABLED` | `true` | Enable scheduled archives |
| `COLLABORATION_BACKUP_DIR` | Sibling `backups` directory | Private backup destination; must be outside the data directory |
| `COLLABORATION_BACKUP_CRON` | `0 0 2 * * *` | Spring cron expression, evaluated in UTC |
| `COLLABORATION_BACKUP_RETENTION_DAYS` | `30` | Completed archive retention; at least one day |
| `COLLABORATION_BACKUP_MAX_BYTES` | `2147483648` | Maximum uncompressed backup bytes; fails visibly on overflow |

Docker Compose mounts `/app/backups` on the separate `collaboration-backups`
volume. Directories are private to UID 10001 and generated archives use mode
0600 on POSIX systems. The archive format is plaintext source content compressed
in ZIP: protect and encrypt the storage and transport. A second volume on the
same host is **not** disaster recovery. Copy completed `.zip` files to independent,
access-controlled storage and configure an alert for a failed or stale backup.
An off-host provider/destination and credentials are deployment inputs, not
invented by the application.

## Restore procedure

Use Python 3 on Linux or macOS. The restore command uses only the standard library.

1. Stop Collaboration Service. Preserve its current volume for investigation or
   rollback; never restore over it.
2. Copy a completed backup from trusted storage and verify it:

   ```sh
   python3 scripts/journal-recovery.py verify /path/to/conflux-backup.zip
   ```

3. Restore to a **new, nonexistent** directory on the persistent filesystem:

   ```sh
   python3 scripts/journal-recovery.py restore /path/to/conflux-backup.zip --target /path/to/restored-documents
   ```

4. Match the service user's ownership (UID 10001 in Docker), keep the directory
   private, and configure `COLLABORATION_DATA_DIR` or the volume mount to use it.
5. Start the same/newer service version. Verify health, open documents from two
   clients, compare the restored history, and retry any pending local edits.

Restore rejects traversal paths, duplicate/unexpected ZIP entries, oversized
content, and checksum failures. It verifies all payloads before creating the new
destination, then forces restored files and the directory to disk. An interrupted
restore leaves `.restore-in-progress`; the service refuses to start against it.
Retry into another new directory. The tool never overwrites an existing live
directory. Restore targets must not be configured in a concurrently starting
service.

## Upgrade and rollback

Before deploying this storage version, stop the old service and take a verified
pre-upgrade backup, or use a storage-level consistent snapshot. For a locally
accessible data directory, the offline tool refuses a lock held by a live service:

```sh
python3 scripts/journal-recovery.py backup /path/to/documents --target /path/to/backups
```

For Docker, stop only Collaboration Service, copy `/app/documents` from its stopped
container to a private directory, then run the same backup command on that copy.
Restart the old container if backup verification fails. Deploy the new image only
after a verified copy exists. Version 3
records cannot be read by older binaries. Rolling back the binary requires
restoring the matching pre-upgrade data into a new volume; do not point an old
binary at a volume containing version 3. Restoring the pre-upgrade backup rolls
back later accepted edits, so preserve the new volume and reconcile those edits
before any rollback. No downgrade conversion is attempted.

## Reproducible validation

Run correctness and integration checks:

```sh
./mvnw test
```

Run the explicit load workload and history-index measurements:

```sh
./mvnw test -Djournal.load=true -Dtest=JournalLoadTests,DocumentHistoryControllerTests
```

The reports are `target/journal-load-report.json` and
`target/history-index-load-report.json`. The storage workload starts with 40,000
UTF-16 text units and alternates 1,500 insert updates across two bound writers.
Most writes measure persistence of trusted generated payloads; every 50th write
passes through the real validator, measured separately. It verifies a backup,
restores it, reconstructs the exact final Yjs state, and retries the original last
operation without a second accepted record. A separate workload fills the
10,000-record limit and verifies safe rejection, restart, and unrelated-document
writes. The normal tests also exhaust the 32 MiB limit, inject persistence and
compaction failures, and check corrupt/incomplete records and hostile archives.

Measured locally on 2026-11-08 (not a production capacity guarantee):

| Measurement | Result |
| --- | --- |
| Snapshot-per-edit serialized size for the generated workload | 113,046,799 bytes |
| Incremental journal | 1,920,101 bytes; **98.3% smaller** |
| Persistence-only append, p50 / p95 | 2.66 / 3.56 ms |
| Real validated writes, p50 / p95 (30 samples) | 143.54 / 163.93 ms |
| Cold journal read / final-state reconstruction | 58.06 / 99.28 ms |
| Backup with verification / restore with verification | 25.59 / 934.92 ms |
| Close-version history request over 10,000 updates / 100 closed versions, p50 / p95 | 1.00 / 2.09 ms |

History timings include an in-process HTTP test client, mocked authorization and
catalog lookups, and a real metadata index. They exclude network/service latency.
Existing relay integration tests cover concurrent writers, deletion, stale
validation, reconnects, revocation, retries, and restarts. Run those plus this
workload on the actual deployment filesystem and hardware before setting SLOs.

## Remaining capacity limits

This is still a **single-writer service**, protected by its data-directory lock.
It is not a horizontally distributed storage system. Limits remain 2 MiB per
update/snapshot, 32 MiB and 10,000 records per document, and 32 active rooms.
Compaction removes redundant snapshots, not canonical operations, so it does not
reset those limits. Exhaustion rejects new writes without a success receipt or
loss of earlier records. Monitor usage and plan archival/segmentation before
approaching the limits; do not silently prune receipts or attribution.

The validator still starts a Node process per request and is limited to two
concurrent processes. The measured validation latency is a remaining typing-path
bottleneck. A bounded persistent worker pool or carefully persisted client update
batching requires separate validation and retry-safety work. Off-host backups,
aggregate disk quotas, long-duration multi-device soak tests, and multi-instance
storage/fanout remain deployment or subsequent engineering work.
