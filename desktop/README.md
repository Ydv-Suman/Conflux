# Conflux Desktop

Tauri 2 desktop authentication client built with TypeScript, Vite, and Tailwind CSS.

## Requirements

- Node.js 22
- npm
- Rust stable
- [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

## Setup

```bash
npm ci
cp .env.example .env
npm start
```

Identity Service must be available at `VITE_IDENTITY_API_URL`, and Workspace Service must be available at `VITE_WORKSPACE_API_URL`. The desktop client sends the in-memory bearer token to Workspace Service but deliberately omits Identity refresh cookies from cross-service requests.

The collaborative editor connects to `VITE_COLLABORATION_WS_URL` (default `ws://localhost:8090`). Select a project and team to open their shared workspace, then open a file from the connected local repository.

Run `npm start` to use local repository features. Open a project and team, select Explorer below the Conflux logo, and choose **Select local folder**. Conflux validates the Git repository, shows its local files, and saves the active file with `Cmd+S` or `Ctrl+S`. Browser-only development at `http://localhost:5173` cannot access local folders.

Device-only repository mappings, the last selected project/workstream, and the last opened file are stored in `conflux.sqlite3` under the operating system's application-data directory. Opened collaborative documents also store their Yjs recovery state and pending updates in SQLite. Their updates are sent to Collaboration Service; unrelated repository files are not copied into this recovery store.

The Projects area lists every project connected to the signed-in user. Opening a project reveals all assigned teams; member details and workstreams load only for teams the user belongs to. Project and team controls are capability-aware for usability, while Identity and Workspace Services remain responsible for every authorization decision.

## Commands

```bash
npm start         # Run the Tauri app
npm start -- two  # Run two isolated Tauri apps for collaboration checks
npm run start:two # Alias for two apps
npm run dev       # Run the Vite frontend
npm run build     # Type-check and build the frontend
npm run lint      # Lint TypeScript
npm test          # Desktop and collaboration protocol checks
npm run package   # Build the native executable
```

Two-app mode opens **Conflux — Test 1** and **Conflux — Test 2** using one Vite
server on port 5173. Each app has its own native state and application-data
directory (`com.conflux.desktop.dev1` / `com.conflux.desktop.dev2`). Browser
sessions are private, so sign into a different account in each app; logins and
browser preferences are cleared when they close. Native repository mappings
persist separately. Select different local clones for the two users to avoid
both editing the same files on disk.

The first two-app launch builds two separate Rust targets and can take longer.
Stop any existing `npm start` or `npm run dev` session first to free port 5173.
Press Ctrl+C to stop both apps and the frontend server; exiting either app also
stops the pair. `npm start` retains the normal app profile.

## Team invitations

Use **Invite member** in a team's Members section to send an invitation to an
existing user's verified email address. Role choices follow the signed-in user's
team hierarchy. Sending an invitation does not add the recipient to the member list.
Managers can view and cancel pending invitations below Members.

The sidebar bell shows pending invitations. Open it to accept or decline; accepting
refreshes available teams and projects. The inbox refreshes every 30 seconds while
the app is visible, when the window regains focus, and through its Refresh button.
Invitation polling does not reload the editor or discard an open file. Both themes
use the existing shared form and button styles.

These controls require the Identity Service invitation APIs and Flyway migration
V9. Delivery is through the in-app inbox, without email or operating-system push
notifications. The inbox and manager list initially show the latest 10 invitations. **Load more**
reveals another 10 when available, up to the 100 returned by the backend.

## Shared team workspace

Requires Workspace Service migration V6 and its default-workstream APIs. Selecting
an assigned team automatically opens the same default workstream for every member;
restarting the desktop restores that team's default rather than a previously selected
feature stream. Selecting the current team again under **Projects** opens its member, invitation,
and project controls, along with previous workstreams retained by the migration.
The editor has a horizontal file-tab bar without the workspace/branch header.
Opening files in Explorer adds tabs; clicking a tab switches files without losing
editor contents, undo history, cursor position, or the collaboration connection.
Tabs show unsaved indicators and confirm before closing unsaved content. Save uses
Cmd+S / Ctrl+S for the active file. Arrow keys and Home/End navigate the tab bar.
Explorer stays open when opening files and shows the project name instead of
internal worktree identifiers, with readable file names in both themes.
Open tabs are scoped to the current workspace; only the last active file is
restored after restarting the app.

A member with `CREATE_WORKSTREAM` permission selects a local Git repository and
chooses **Set up shared workspace**. The desktop initializes the existing default
using its planned branch and the repository's actual HEAD commit. When the source has uncommitted changes on another branch, **Set up from last commit**
creates a separate worktree from HEAD; staged, unstaged, and untracked changes stay
in the source folder and are not included. Initial setup is still blocked when the
source is already on the shared branch with uncommitted changes, or when an existing
shared branch is not checked out. Concurrent
setup resolves to the server's initialized default. Other members see a waiting
screen that checks for completed setup every 15 seconds and on window focus.

Once initialized, Conflux reuses the device's saved shared folder or opens a managed
worktree from the connected project repository. A missing local branch is created
at the current shared revision. A clone already on that branch and revision can
be used directly. Local branch/revision mismatches stop the editor and show a
recoverable error; Conflux never resets local work. Existing dirty shared folders
can reopen when their branch and HEAD still match.

Each device uses its own local clone with the shared commit available. It can now download that clone from the configured remote.
Publishing Git revisions and per-task contribution attribution are separate work. These controls use the existing light/dark theme
styles. Run `npm test`, `npm run build`, `npm run lint`, and
`cargo test --manifest-path src-tauri/Cargo.toml` to validate this integration.

## Downloading an invited project

After accepting an invitation, a dialog lists the projects assigned to that team.
Choose **Download project**, then select a parent folder. The native desktop creates
a folder named after the project (for example, `iris-predictor`) inside that folder, checks the published canonical commit,
checks out the team's shared branch at its current revision, and opens Explorer.
The destination must be new: existing folders and work are never overwritten.
Canceling the picker keeps the invitation accepted and the existing editor open.
The same download action is available in the team's workspace when it has no local
copy, so it can be used after dismissing the invitation dialog or restarting.

A project creator or manager configures **Repository settings** from the project
page or shared-workspace setup screen. These controls require Workspace Service
migration V7. For a connected repository, an unconfigured form detects the remote URL, current
branch, and full HEAD commit through Git, including linked worktrees with a `.git`
file. It prefers the tracking remote, then `origin`, then a sole remote. Saved
server settings take precedence. Embedded URL credentials and query parameters are
stripped before reaching the UI. SSH suggests SSH-agent access; HTTPS suggests a
credential helper because local metadata cannot establish public visibility. All
fields remain editable. Confirm that the detected branch and commit are published. Concurrent settings edits require reloading before saving again.
The repository and all required shared commits must already be published to that
remote; Conflux does not upload the inviter's local or uncommitted files.

Public HTTPS downloads use no Git credential helper. Private HTTPS uses each
member's configured Git credential helper; SSH uses their agent and an already
trusted host. Interactive terminal credential prompts are disabled. Provider
permissions remain separate from Conflux team membership. Clone errors give retry
instructions without displaying credential-helper output. Git runs off the UI
thread with a three-minute timeout per operation. Failed downloads remove only the
newly created destination; existing folders are preserved. Submodules are not
recursively downloaded.

When the shared workspace is uninitialized, members with setup permission can
**Download and set up workspace**. Developers may download the canonical snapshot
but must wait for an authorized member to initialize the shared workspace. Access
and shared-workstream state are rechecked after downloading. Missing/unpublished
commits stop opening the editor; they are never silently replaced with remote HEAD.
Browser users see instructions to open the native desktop app for local downloads.

Verification includes mocked invitation/download flows and real local Git clone,
checkout, revision validation, and existing-file preservation tests. External
private-provider authentication requires a manual test with configured credentials.

## Secured collaborative editing

Requires the authenticated Collaboration Service protocol and opt-in durable
receipts introduced in backend commit `a9c846f` (merge/deploy that backend change
alongside this desktop update). A server without receipts leaves edits pending;
connection status never substitutes for a persistence receipt. The desktop sends the team ID and
in-memory access token as the first WebSocket text message. Tokens are never placed
in WebSocket URLs or local storage. Expired tokens are refreshed once per failed
connection; tabs reuse a token that another tab has already refreshed.

Only the participant selected by the server initializes a new file from disk.
Existing documents replay their persisted Yjs history, including intentionally
empty documents. Editing and local saves stay disabled until the first replay
completes, so an empty loading editor cannot overwrite a local file.

The right side of the file-tab bar shows a green Connected dot or red Disconnected
dot for the active file. The editor status separately shows local recovery saving,
local file saving, pending server receipts, saved/synced, offline, and errors.
**Saved locally and synced** requires successful local file saving, durable recovery
storage, and acknowledgement of all pending updates. Connection alone does not
establish persistence.

Each document's Yjs snapshot and exact pending update bytes are persisted together
in native SQLite before transmission. Records are scoped by server/document URL,
team, and signed-in user; stable document IDs retain recovery state across renames.
Reopening a document restores the snapshot and resends its pending bytes after
server replay. The desktop opts into backend receipts and clears a payload only
after its SHA-256 receipt arrives. Lost receipts retry the same bytes, including
after restart, without producing duplicate server history. Snapshot and outbox
writes are serialized, including across closing and reopening a tab.

After a document has synchronized once, its recovered contents remain editable
while offline. Reopen other previously edited files in Explorer to recover their
pending changes; only the last active file is automatically reopened. A new file
still waits for server initialization. Membership denial stops automatic retries
and makes the editor read-only while preserving contents for a local save.

A storage error stops network sends and leaves the tab dirty. Keep the tab open,
use **Save locally** to preserve the text, fix the storage issue, then **Retry**.
A crash while the status still says **Saving recovery data…** can lose edits whose
local write has not completed. Recovery records have a 64 MiB limit per document;
exceeding it fails visibly rather than discarding pending updates. There is no
automatic pruning or CRDT compaction yet. **Save locally** writes the text file;
it does not publish a Git commit. Close/workspace-change prompts remain conservative
while edits are unsaved or awaiting acknowledgement.

`npm test` covers actual Yjs convergence with a deterministic relay fixture, concurrent
first opens, empty-document replay, offline edits, token refresh, access denial,
backpressure, disposal, and size limits. To test the production desktop transport
against the actual Java relay, first package Collaboration Service with
`./mvnw package` in its service directory, then run `npm run test:collaboration`
here. This starts temporary Identity/Workspace HTTP fixtures and a real Java relay,
connects two Yjs clients, destroys and recreates one client from persisted recovery data, restarts the relay, waits for durable receipts, and verifies
contributor records and membership revocation. Set `COLLABORATION_JAR` to use another
packaged relay. This check does not log in through the native desktop UI.

## Fonts

Choose **Fonts** in Settings for four controls: **File font size**, **File font
family**, **Editor font size**, and **Editor font family**. Size inputs accept
10–24 px for file names and 10–32 px for editor text. File preferences apply to
Explorer entries and file tabs; editor preferences update open editors without
recreating documents or collaboration connections.

File families: System default, Arial, Helvetica, Verdana, Georgia, Times New Roman.
Editor families: JetBrains Mono, Fira Code, Consolas, Menlo, Cascadia Code, Source
Code Pro. The four open-source editor fonts are bundled for offline use; Menlo,
Consolas, and file fonts use locally installed fonts with fallbacks. Source and
license details are in `src/assets/fonts/README.md`. Preferences save on this
device, and existing size preferences are retained. **Reset** restores 14 px,
System default for files, and Menlo for the editor. Close with **Done**, Escape,
or the close button.
