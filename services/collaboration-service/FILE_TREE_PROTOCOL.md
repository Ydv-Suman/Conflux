# Workstream file synchronization

The Collaboration backend maintains an ordered file tree for each workstream.
It supports adding files and folders, renaming/moving either, and deleting either.
Folder renames and deletes include all descendants atomically. This API does not
write files on users' computers or push Git commits. Desktop integration is the
next step; the current desktop does not subscribe to this channel yet.

## Connection and authentication

Connect to `/ws/projects/{projectId}/workstreams/{workstreamId}/files` and send a
text frame within five seconds:

```json
{"teamId":"team-uuid","token":"identity-access-token","afterVersion":0}
```

Both route IDs must be UUIDs. Query parameters are forbidden. Tokens belong only
in this first frame and are never persisted. The server verifies Identity's
`JOIN_WORKSTREAM` and `EDIT_DOCUMENT` capabilities and Workspace's exact
project/team/workstream relationship. The repository must be ready and the
workstream must not be merged or archived. The actor is derived from Identity.
Authorization runs before replay, before **every mutation**, and every five
seconds while idle. Dependency failures close the connection rather than allowing
changes without authorization.

After authentication, the server sends persisted events newer than `afterVersion`
(default `0`), in ascending order, followed by:

```json
{"type":"synced","version":0,"initialized":false}
```

Use `afterVersion: 0` for a new client. A reconnecting client may send the last
version it durably applied to its local tree. Negative or future cursors are
rejected. Wait for `synced` before submitting operations.

## Initialize the shared tree

When `initialized` is false, one authorized desktop submits the baseline manifest
from the agreed shared Git revision, including parent directories. Do not include
untracked local files in the baseline; submit them as `CREATE` after initialization.
Entries may be listed in any order. An empty manifest is valid for an empty repo.

```json
{
  "operationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "expectedVersion":0,
  "type":"INITIALIZE",
  "entries":[
    {"id":"directory-id","path":"src","kind":"DIRECTORY"},
    {"id":"existing-document-id","path":"src/Main.java","kind":"FILE"}
  ]
}
```

Entry IDs must be unique strings of 1–128 ASCII letters, digits, dots, underscores,
or hyphens. IDs are stable through renames and **cannot be reused after deletion**.
For existing files, preserve the current desktop's `documentIdForPath(originalPath)`
value as the entry ID, so their existing Yjs history remains accessible. New entries
should use fresh UUID strings. For files, use the entry ID as `documentId` on the
existing document WebSocket endpoint; never recalculate it after a rename.

Only one initialization wins. A competing initializer receives a conflict and
must use the accepted manifest, not replace it. Baseline content comes from each
member's Git clone and existing document history, not this manifest.

## Create a file or folder

```json
{
  "operationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "expectedVersion":1,
  "type":"CREATE",
  "entry":{"id":"new-file-id","path":"src/Helper.java","kind":"FILE"},
  "content":"class Helper {}\n"
}
```

For a folder, use `kind: "DIRECTORY"` and omit `content`. For a file, `content` is
required and may be an empty string (for example, a file created with `touch`).
The parent folder must already exist. Create nested directories from the top down.
Initial text is stored in the event for offline replay; subsequent text edits use
the existing document/Yjs channel. Its initializer must seed from the accepted
content, while other participants wait for that document's `synced` frame.

## Rename, move, and delete

```json
{
  "operationId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "expectedVersion":2,
  "type":"RENAME",
  "path":"src/Helper.java",
  "targetPath":"src/Utils.java"
}
```

The same command works for folders: renaming `src` to `source` moves all descendants
without changing their entry IDs. The destination parent must exist. Replacing an
existing entry, moving a folder into itself, and case-insensitive name collisions
are rejected. Case-only renames are permitted if they do not collide.

```json
{
  "operationId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "expectedVersion":3,
  "type":"DELETE",
  "path":"src"
}
```

Deleting a folder removes its whole subtree from the shared tree in one event.
The history retains the operation and the deleted IDs. Document journals are not
erased; desktop clients must close the deleted files' document sessions and tabs.
Creating the same path again requires a new ID, so old text cannot reappear in the
new file. The document relay remains compatible with existing clients; it does not
independently reject updates to a deleted file's old document ID.

## Acknowledgements, conflicts, and replay

Accepted commands are forced to durable storage **before** broadcasting to all
connected participants, including the sender:

```json
{
  "type":"event",
  "version":2,
  "actorId":"identity-user-uuid",
  "timestamp":"2026-10-27T12:00:00Z",
  "command":{"operationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","expectedVersion":1,"type":"CREATE","entry":{"id":"new-file-id","path":"src/Helper.java","kind":"FILE"},"content":"class Helper {}\n"}
}
```

Commands are serialized per workstream. `expectedVersion` must match its current
version. A stale version, existing destination, missing source/parent, or reused
entry ID produces a `conflict` message with `operationId`, current `version`, and
a reason. The socket stays open. Reconcile the accepted events and local changes
before creating a new operation; do not blindly retry a stale delete or rename.

Retry an unacknowledged request with the **same operation ID and exact command**.
For the same authenticated actor, the server returns the original event without
writing or broadcasting it again, even after a restart. Changing that request or
reusing another actor's operation ID is rejected. Ignore already-applied event
versions and never move the local cursor backwards when receiving a retry reply.

## Paths, storage, and limits

Paths are NFC-normalized, relative, slash-separated paths. Absolute paths,
traversal, empty segments, backslashes, control characters, Windows device names,
and `.git` / `.conflux` components are forbidden. Parents must be directories;
symlinks are not a supported entry type. Names must be unique ignoring letter
case. Limits are 32 path components, 240 UTF-8 bytes per component, and 1024 bytes
per complete path.

Per workstream: 5,000 live entries, 10,000 accepted operations, and 8 MiB of stored
commands. New file content is text, at most 256 KiB UTF-8, with no NUL characters.
Commands must fit within 2 MiB minus 1 KiB reserved for the event envelope. Limits
reject further changes without deleting existing history. Eight file-tree rooms
may be active at once, with 32 participants each; slow participants exceeding
64 queued messages or 4 MiB are disconnected and can replay later.

The existing checksummed journal and exclusive single-process lock are reused in
`COLLABORATION_DATA_DIR`, under keys inaccessible through document endpoints. Keep
the volume persistent. Partial final writes are recovered; corrupt history fails
closed. File-tree compaction and multiple server replicas are not implemented.

Close codes: `4401` authentication, `4403` access denied, `1008` invalid protocol
or path, `1009` oversized transport frame, `1013` dependency/storage/capacity failure.

## Desktop integration requirements

- Watch only the active workstream root; honor Git ignore rules and exclude secrets
  and internal directories before publishing new files.
- Apply remote operations without publishing watcher echoes back as new changes.
- Verify resolved paths remain inside the selected root and refuse symlink traversal.
- Preserve dirty or conflicting local files instead of silently overwriting/deleting
  them. Treat a remote operation as a request to reconcile, not permission to lose work.
- Retain the last applied version, entry IDs, and pending operation IDs across restarts.
- Use stable entry IDs for documents, update Explorer and tabs after rename/delete,
  and apply missed events in order before enabling local structural changes.
