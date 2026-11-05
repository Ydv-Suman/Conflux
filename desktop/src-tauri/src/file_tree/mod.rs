//! Filesystem boundary for shared tree synchronization.
mod apply;
mod paths;
mod scan;

#[cfg(test)]
mod tests;

use crate::{repository::RepositoryState, storage::database};
use apply::apply;
use paths::{allowed, check_root, safe_path};
use rusqlite::{params, OptionalExtension};
use scan::snapshot;
use serde::{Deserialize, Serialize};
use std::{fs, process::Command};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: String,
    kind: String,
    identity: String,
    fingerprint: String,
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
