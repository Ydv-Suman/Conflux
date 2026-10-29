//! Filesystem boundary for shared tree synchronization. Every call is scoped to
//! the currently selected root; links and private/internal paths are never followed.
use crate::repository::{database, RepositoryState};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    fs,
    hash::Hasher,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: String,
    kind: String,
    identity: String,
    fingerprint: String,
}

fn allowed(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 1024
        && path.split('/').count() <= 32
        && !path.contains(':')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path.split('/').all(|p| {
            !p.is_empty()
                && p.len() <= 240
                && p != "."
                && p != ".."
                && !matches!(
                    p.to_lowercase().as_str(),
                    ".git"
                        | ".conflux"
                        | "node_modules"
                        | "target"
                        | "dist"
                        | ".ssh"
                        | ".aws"
                        | ".env"
                        | "credentials"
                )
                && !matches!(
                    p.split('.').next().unwrap_or("").to_uppercase().as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
                && !p.ends_with('.')
                && !p.ends_with(' ')
                && !p.to_lowercase().starts_with(".env.")
                && !p.to_lowercase().ends_with(".pem")
                && !p.to_lowercase().ends_with(".key")
        })
}

fn safe_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    if !allowed(path) {
        return Err(format!("Unsafe or private path: {path}"));
    }
    let mut result = root.to_path_buf();
    for component in path.split('/') {
        result.push(component);
        match fs::symlink_metadata(&result) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("Symbolic links are not synchronized: {path}"))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(result)
}

fn check_root(root: &str, state: &RepositoryState) -> Result<PathBuf, String> {
    let selected = state.0.lock().map_err(|e| e.to_string())?;
    let root = PathBuf::from(root);
    if selected.as_ref() != Some(&root) {
        return Err("The active repository changed. Reopen the workspace.".into());
    }
    Ok(root)
}

fn identity(meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}:{:?}", meta.dev(), meta.ino(), meta.created().ok())
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        String::new()
    }
}

fn fingerprint(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Ok(String::new());
    }
    let mut hash = DefaultHasher::new();
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = [0u8; 8192];
    loop {
        let n = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.write(&bytes[..n]);
    }
    Ok(format!("{:016x}", hash.finish()))
}

fn scan(
    root: &Path,
    dir: &Path,
    tracked: &HashSet<String>,
    entries: &mut Vec<Entry>,
) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Non-UTF8 path")?
            .replace('\\', "/");
        if !allowed(&relative) {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() || !(meta.is_dir() || meta.is_file()) {
            continue;
        }
        if meta.is_file() && !tracked.contains(&relative) {
            continue;
        }
        if meta.is_dir() {
            let ignored = Command::new("git")
                .arg("-C")
                .arg(root)
                .args(["check-ignore", "-q", "--", &relative])
                .status()
                .map_err(|e| e.to_string())?;
            if ignored.success()
                && !tracked
                    .iter()
                    .any(|path| path.starts_with(&format!("{relative}/")))
            {
                continue;
            }
            if !matches!(ignored.code(), Some(0 | 1)) {
                return Err("Unable to check Git ignore rules.".into());
            }
        }
        let identity = identity(&meta);
        entries.push(Entry {
            path: relative,
            kind: if meta.is_dir() { "DIRECTORY" } else { "FILE" }.into(),
            identity,
            fingerprint: if meta.is_file() {
                fingerprint(&path)?
            } else {
                String::new()
            },
        });
        if entries.len() > 5000 {
            return Err("File synchronization supports at most 5,000 entries.".into());
        }
        if meta.is_dir() {
            scan(root, &path, tracked, entries)?;
        }
    }
    Ok(())
}

fn snapshot(root: &Path) -> Result<Vec<Entry>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Unable to inspect Git ignore rules.".into());
    }
    let tracked = String::from_utf8(output.stdout)
        .map_err(|e| e.to_string())?
        .split('\0')
        .map(str::to_owned)
        .collect();
    let mut entries = Vec::new();
    scan(root, root, &tracked, &mut entries)?;
    Ok(entries)
}

#[tauri::command]
pub async fn file_tree_snapshot(
    root: String,
    state: State<'_, RepositoryState>,
) -> Result<Vec<Entry>, String> {
    let root = check_root(&root, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = snapshot(&root)?;
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn file_tree_baseline(
    root: String,
    revision: String,
    state: State<'_, RepositoryState>,
) -> Result<Vec<String>, String> {
    let root = check_root(&root, &state)?;
    if revision.len() != 40 || !revision.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid shared Git revision.".into());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["ls-tree", "-rz", &revision])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("The shared Git revision is unavailable locally.".into());
    }
    let mut paths = Vec::new();
    for row in output.stdout.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let row = std::str::from_utf8(row).map_err(|e| e.to_string())?;
        let (header, path) = row.split_once('\t').ok_or("Invalid Git tree")?;
        if header.starts_with("100") && allowed(path) {
            paths.push(path.into());
        }
    }
    Ok(paths)
}

fn storage(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let db = database(app)?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS file_tree_state (scope TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(db)
}

#[tauri::command]
pub fn file_tree_load(
    app: AppHandle,
    root: String,
    scope: String,
    state: State<'_, RepositoryState>,
) -> Result<Option<String>, String> {
    check_root(&root, &state)?;
    storage(&app)?
        .query_row(
            "SELECT value FROM file_tree_state WHERE scope=?1",
            [format!("{root}/{scope}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn file_tree_save(
    app: AppHandle,
    root: String,
    scope: String,
    value: String,
    state: State<'_, RepositoryState>,
) -> Result<(), String> {
    check_root(&root, &state)?;
    if value.len() > 8 * 1024 * 1024 {
        return Err("Local synchronization state is too large.".into());
    }
    storage(&app)?.execute("INSERT INTO file_tree_state(scope,value) VALUES(?1,?2) ON CONFLICT(scope) DO UPDATE SET value=excluded.value", params![format!("{root}/{scope}"),value]).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    operation_id: String,
    kind: String,
    path: String,
    target_path: Option<String>,
    content: Option<String>,
    fingerprint: Option<String>,
    identity: Option<String>,
}

fn apply(root: &Path, recovery: &Path, change: &Change) -> Result<(), String> {
    if change.operation_id.len() != 36
        || !change
            .operation_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("Invalid operation ID".into());
    }
    let source = safe_path(root, &change.path)?;
    match change.kind.as_str() {
        "FILE" => {
            let content = change.content.as_deref().ok_or("Missing initial content")?;
            if content.len() > 256 * 1024 || content.contains('\0') {
                return Err("Only text files up to 256 KiB can be shared.".into());
            }
            if source.exists() {
                if fs::read(&source).map_err(|e| e.to_string())? == content.as_bytes() {
                    return Ok(());
                }
                return Err(format!(
                    "Local file conflicts with a shared file: {}. Move it aside and retry.",
                    change.path
                ));
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(source)
                .map_err(|e| e.to_string())?;
            file.write_all(content.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
        }
        "DIRECTORY" => {
            if !source.is_dir() {
                fs::create_dir(source).map_err(|e| e.to_string())?;
            }
        }
        "RENAME" => {
            let target = safe_path(
                root,
                change.target_path.as_deref().ok_or("Missing destination")?,
            )?;
            if !source.exists() {
                // An inode survives a move, including a folder move. This lets
                // replay finish after a crash between the rename and cursor save.
                if let Ok(meta) = fs::symlink_metadata(&target) {
                    if change
                        .identity
                        .as_ref()
                        .is_some_and(|id| !id.is_empty() && *id == identity(&meta))
                    {
                        return Ok(());
                    }
                }
                // Files also have a conservative fallback on other platforms.
                if target.is_file()
                    && change
                        .fingerprint
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                    && change.fingerprint.as_ref() == Some(&fingerprint(&target)?)
                {
                    return Ok(());
                }
                return Err(format!(
                    "Rename source is missing: {}. Restore it and retry.",
                    change.path
                ));
            }
            if target.exists() && fs::canonicalize(&source).ok() != fs::canonicalize(&target).ok() {
                return Err("Rename destination already exists. Move it aside and retry.".into());
            }
            fs::rename(source, target).map_err(|e| e.to_string())?;
        }
        "DELETE" => {
            if !source.exists() {
                return Ok(());
            }
            fs::create_dir_all(recovery).map_err(|e| e.to_string())?;
            let target = recovery.join(&change.operation_id);
            if target.exists() {
                return Err("A recovery copy already exists. Move the conflicting local item aside and retry.".into());
            }
            // Keep all local contents, including ignored files inside a deleted folder.
            fs::write(
                recovery.join(format!("{}.path", change.operation_id)),
                root.join(&change.path).to_string_lossy().as_bytes(),
            )
            .map_err(|e| e.to_string())?;
            fs::rename(source, target)
                .map_err(|e| format!("Could not preserve the deleted item: {e}"))?;
        }
        _ => return Err("Unknown file operation".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn file_tree_apply(
    app: AppHandle,
    root: String,
    change: Change,
    state: State<'_, RepositoryState>,
) -> Result<(), String> {
    let root = check_root(&root, &state)?;
    let recovery = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("file-recovery");
    apply(&root, &recovery, &change)
}

#[tauri::command]
pub fn file_tree_content(
    root: String,
    path: String,
    state: State<'_, RepositoryState>,
) -> Result<String, String> {
    let root = check_root(&root, &state)?;
    let file = safe_path(&root, &path)?;
    if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 256 * 1024 {
        return Err(format!(
            "{path}: new shared files must be text and at most 256 KiB."
        ));
    }
    let content =
        fs::read_to_string(file).map_err(|_| format!("{path}: binary files cannot be shared."))?;
    if content.contains('\0') {
        return Err(format!("{path}: binary files cannot be shared."));
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    static FIXTURE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "conflux-tree-{}-{}-{}",
                std::process::id(),
                FIXTURE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            assert!(Command::new("git")
                .arg("init")
                .arg("-q")
                .arg(&path)
                .status()
                .unwrap()
                .success());
            Self(path)
        }
        fn change(&self, kind: &str, path: &str) -> Change {
            Change {
                operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
                kind: kind.into(),
                path: path.into(),
                target_path: None,
                content: Some(String::new()),
                fingerprint: None,
                identity: None,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn scan_honors_ignores_private_paths_and_empty_directories() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join(".gitignore"), "ignored/\n*.log\n").unwrap();
        for dir in ["ignored", "empty", ".conflux"] {
            fs::create_dir(fixture.0.join(dir)).unwrap();
        }
        for file in [
            "Main.java",
            ".env",
            ".env.local",
            "key.pem",
            "debug.log",
            "ignored/private",
            ".conflux/state",
        ] {
            fs::write(fixture.0.join(file), "").unwrap();
        }
        let entries = snapshot(&fixture.0).unwrap();
        let paths: HashSet<_> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, HashSet::from([".gitignore", "Main.java", "empty"]));
    }
    #[test]
    fn remote_create_never_overwrites_and_rename_preserves_content() {
        let fixture = Fixture::new();
        let recovery = fixture.0.join("recovery");
        let mut change = fixture.change("FILE", "Main.java");
        change.content = Some("shared".into());
        apply(&fixture.0, &recovery, &change).unwrap();
        apply(&fixture.0, &recovery, &change).unwrap();
        fs::write(fixture.0.join("Main.java"), "local edits").unwrap();
        assert!(apply(&fixture.0, &recovery, &change).is_err());
        change.kind = "RENAME".into();
        change.target_path = Some("Other.java".into());
        change.fingerprint = Some(fingerprint(&fixture.0.join("Main.java")).unwrap());
        apply(&fixture.0, &recovery, &change).unwrap();
        apply(&fixture.0, &recovery, &change).unwrap();
        assert_eq!(
            fs::read_to_string(fixture.0.join("Other.java")).unwrap(),
            "local edits"
        );
    }
    #[test]
    fn delete_retains_whole_folder_including_ignored_local_work() {
        let fixture = Fixture::new();
        let recovery = fixture.0.join("recovery");
        fs::create_dir(fixture.0.join("src")).unwrap();
        fs::write(fixture.0.join("src/.env"), "private").unwrap();
        let change = fixture.change("DELETE", "src");
        apply(&fixture.0, &recovery, &change).unwrap();
        apply(&fixture.0, &recovery, &change).unwrap();
        assert_eq!(
            fs::read_to_string(recovery.join(&change.operation_id).join(".env")).unwrap(),
            "private"
        );
        assert!(!fixture.0.join("src").exists());
        assert!(
            fs::read_to_string(recovery.join(format!("{}.path", change.operation_id)))
                .unwrap()
                .ends_with("/src")
        );
    }
    #[test]
    #[cfg(unix)]
    fn folder_rename_replay_recovers_after_cursor_save_was_interrupted() {
        let fixture = Fixture::new();
        let recovery = fixture.0.join("recovery");
        fs::create_dir(fixture.0.join("src")).unwrap();
        fs::write(fixture.0.join("src/Main.java"), "local content").unwrap();
        let mut change = fixture.change("RENAME", "src");
        change.target_path = Some("source".into());
        change.identity = Some(identity(&fs::metadata(fixture.0.join("src")).unwrap()));
        apply(&fixture.0, &recovery, &change).unwrap();
        apply(&fixture.0, &recovery, &change).unwrap();
        assert_eq!(
            fs::read_to_string(fixture.0.join("source/Main.java")).unwrap(),
            "local content"
        );
        // A different destination must never be mistaken for a completed move.
        change.identity = Some("different-inode".into());
        assert!(apply(&fixture.0, &recovery, &change).is_err());
    }

    #[test]
    fn rejects_traversal_and_symlinks_and_stale_roots() {
        let fixture = Fixture::new();
        for path in [
            "../escape",
            "/absolute",
            "a/../b",
            ".git/config",
            "a\\b",
            "C:/escape",
            ".env",
            "x//y",
        ] {
            assert!(safe_path(&fixture.0, path).is_err(), "{path}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), fixture.0.join("link")).unwrap();
            assert!(safe_path(&fixture.0, "link/escape").is_err());
            assert!(!snapshot(&fixture.0)
                .unwrap()
                .iter()
                .any(|e| e.path == "link"));
        }
        assert!(check_root(fixture.0.to_str().unwrap(), &RepositoryState::default()).is_err());
    }
}
