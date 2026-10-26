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

Device-only repository mappings, the last selected project/workstream, and the last opened file are stored in `conflux.sqlite3` under the operating system's application-data directory. Repository contents are not copied into SQLite or uploaded to Conflux.

The Projects area lists every project connected to the signed-in user. Opening a project reveals all assigned teams; member details and workstreams load only for teams the user belongs to. Project and team controls are capability-aware for usability, while Identity and Workspace Services remain responsible for every authorization decision.

## Commands

```bash
npm start         # Run the Tauri app
npm run dev       # Run the Vite frontend
npm run build     # Type-check and build the frontend
npm run lint      # Lint TypeScript
npm test          # Invitation and shared-workspace checks
npm run package   # Build the native executable
```

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
feature stream. **Team details** keeps member, invitation, and project controls
accessible, along with previous workstreams retained by the migration.

A member with `CREATE_WORKSTREAM` permission selects a local Git repository and
chooses **Set up shared workspace**. The desktop initializes the existing default
using its planned branch and the repository's actual HEAD commit. Setup is blocked
for a dirty source or an existing shared branch that is not checked out. Concurrent
setup resolves to the server's initialized default. Other members see a waiting
screen that checks for completed setup every 15 seconds and on window focus.

Once initialized, Conflux reuses the device's saved shared folder or opens a managed
worktree from the connected project repository. A missing local branch is created
at the current shared revision. A clone already on that branch and revision can
be used directly. Local branch/revision mismatches stop the editor and show a
recoverable error; Conflux never resets local work. Existing dirty shared folders
can reopen when their branch and HEAD still match.

Each device still needs its own local clone with the shared commit available.
Automatic clone/download, publishing Git revisions, and per-task contribution
attribution are separate work. These controls use the existing light/dark theme
styles. Run `npm test`, `npm run build`, `npm run lint`, and
`cargo test --manifest-path src-tauri/Cargo.toml` to validate this integration.
