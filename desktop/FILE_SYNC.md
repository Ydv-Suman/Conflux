# Shared files in the desktop

Open the same team workstream on two desktops, with a separate local clone for
each member (including when using `npm run start:two` on one computer).
The active worktree is scanned once per second. Terminal-created files such as
`touch Main.java` appear in Explorer and are sent to connected teammates.
The icons beside the project name add files/folders in the selected folder or
retry synchronization. Creation uses an inline name field: Enter or clicking
elsewhere creates the item; an empty name or Escape cancels. The field uses the
configured Explorer font.
Two-finger click on Mac or right-click on Windows for **Rename** and **Delete**
(keyboard: Shift+F10). Folder menus also offer **New file** and **New folder**,
with the selected folder prefilled as the parent. Rename accepts a new relative
path to move an item. Create parent folders before creating files within them.

The desktop authenticates to the Collaboration service's `/files` WebSocket,
replays missed operations in order, and stores its cursor, stable document IDs,
observed filesystem identities, and exact pending command in native SQLite.
Renames retain the document's existing collaborative editing history. Deleted
clean tabs close; dirty tabs stop synchronization until they are saved or closed.
Changes received from teammates are not sent back as new operations.

Git ignore rules, symlinks, internal/build directories, `.env` variants, `.ssh`,
`.aws`, `credentials`, and `.pem`/`.key` files are excluded. New shared files must
be UTF-8 text without NUL bytes, at most 256 KiB. Other files stay local and an
unsupported new file pauses synchronization with an error. Move it outside the
shared tree or ignore it, then retry. Open files autosave locally after 600 ms without changes and when the editor
loses focus, including received collaborative edits. Saving waits for document
initialization, serializes writes, and preserves the dirty indicator on failure.
A changed active root or independently modified disk file stops the write.
Existing file content uses the editor's document/Yjs channel, with SQLite recovery state and pending updates retained until durable server acknowledgement; this does not synchronize arbitrary external text
edits or binary content, commit to Git, or push to the remote repository.

Incoming creates never overwrite differing local content. Deletions move local
contents into `file-recovery` in the Conflux application data directory. Each copy
uses an operation UUID and has an adjacent `.path` file recording its original
location. On macOS this is normally under
`~/Library/Application Support/<application identifier>/file-recovery` (development
instances have distinct identifiers). If a recovery move cannot be completed,
synchronization stops and leaves the source in place.

**Retry file sync** replays from the last durable cursor and resends an uncertain
command with the same operation ID. For stale-version conflicts, first inspect
the local tree. **Use reviewed local tree** explicitly discards the pending
command and reconciles local additions, moves, and missing entries after replay;
missing shared entries can become shared deletions. Do not select it until the
local tree represents what you intend to share.

Native file identities detect terminal renames on macOS/Linux. Explorer renames
preserve IDs on every platform; platforms without native identities may observe
terminal moves as delete/create. Scanning sees the final filesystem state, so
transient create/delete sequences entirely between scans are not recorded.
Synchronization runs while the shared workspace is open; reopening replays
missed events. Use separate clones, not two processes editing the same folder.

Verification:

```sh
cd desktop
npm test
npm run lint
npm run build
cd src-tauri
cargo test --lib
```

For a manual two-user check: open the same workstream from separate clones, create
`src/Main.java`, rename it to `src/App.java`, then delete its folder. Verify both
Explorers converge, the renamed file retains its document history, dirty tabs
prevent remote deletion, and changes replay after closing/reopening one app.

Explorer uses Material Icon Theme with filename/extension/folder-name mappings,
light/dark variants, and open/closed folder icons. Assets and the upstream license
are generated locally by `npm run prepare:icons`, which runs before dev, build,
and tests; no network access is needed at runtime. See `THIRD_PARTY_NOTICES.md`.
