# Native runtime structure

Conflux uses one Rust crate, organized by native responsibility. React owns the UI
and collaboration transport; Rust owns local Git operations, filesystem access,
and durable device storage. Tauri commands connect those two sides.

```text
src-tauri/
├── Cargo.toml            # Native dependencies and crate configuration
├── build.rs             # Tauri build integration
├── tauri.conf.json       # App, window, and bundle configuration
├── capabilities/         # Tauri plugin permissions
├── icons/                # Application icons
└── src/
    ├── main.rs           # Desktop executable entry point
    ├── lib.rs            # App setup, managed state, command registration
    ├── storage.rs        # SQLite connection and existing bootstrap schema
    ├── workspace.rs      # Last workspace and last-opened-file preferences
    ├── document.rs       # Atomic document snapshot/outbox recovery storage
    ├── repository/
    │   ├── mod.rs        # Connect/restore/inspect, metadata, types, active root
    │   ├── git.rs        # Local Git execution and repository validation
    │   ├── files.rs      # Editor reads, guarded saves, initial Explorer tree
    │   ├── worktree.rs   # Exact-revision worktree creation and mapping
    │   ├── download.rs   # Validated clone, credentials policy, checkout, tests
    │   └── tests.rs      # Repository, worktree, and file-preservation tests
    └── file_tree/
        ├── mod.rs        # Sync commands, payload types, persisted sync cursor
        ├── paths.rs      # Private-path exclusions, symlink and root checks
        ├── scan.rs       # Git-aware scans, file identities, fingerprints
        ├── apply.rs      # Create/rename/delete with conflict and recovery rules
        └── tests.rs      # Filesystem synchronization and safety tests
```

## Module boundaries

- `lib.rs` wires the app together. Register commands here; put their behavior in
  the owning feature module.
- `repository` owns the selected local root and repository mappings. Its Git
  helpers are private to that feature. Network downloads retain their separate
  credential handling, timeouts, and sanitized errors.
- `file_tree` uses the selected repository root and shared database. Path policy,
  scanning, and filesystem mutation stay separate so their safety checks remain
  easy to inspect. Its stricter sharing policy is distinct from local editor reads.
- `workspace` stores device navigation preferences. `document` stores opaque
  recovery payloads; Yjs interpretation and WebSocket transport remain in TypeScript.
- `storage` is shared infrastructure and does not import feature modules. It keeps
  the existing database location and bootstrap tables. Document and file-tree
  modules retain their own table initialization and persistence settings.

Keep helper modules private and expose functions only as far as their callers
require. Small features can remain a single file with inline unit tests. Larger
features use a directory with focused helpers and a sibling `tests.rs`; tests
should not force implementation details into the public crate API.

## Compatibility

This reorganization preserves Tauri command names, arguments, serialized field
names, SQLite tables, app-data paths, Git behavior, and filesystem safeguards.
Frontend `invoke(...)` calls and existing local data require no migration.

## Growing the runtime

Add a top-level feature module when native behavior is implemented: for example,
`terminal/` for PTY sessions or `credentials/` for OS credential storage. Keep
frontend orchestration and backend services outside the Rust runtime. Extract a
separate crate only when there is an actual independent consumer or build boundary.

## Checks

From `desktop/`:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
npm test
```
