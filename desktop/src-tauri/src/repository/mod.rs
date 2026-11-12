//! Repository connections, metadata, and the currently selected local root.
pub(crate) mod changes;
pub(crate) mod download;
pub(crate) mod files;
mod git;
pub(crate) mod worktree;

#[cfg(test)]
mod tests;

use crate::storage::{database, database_error};
use files::read_tree;
use git::{git, validate_repository};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct RepositoryState(pub(crate) Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    path: String,
    name: String,
    branch: String,
    revision: String,
    modified: bool,
    branches: Vec<String>,
    files: Vec<FileEntry>,
    last_opened_file: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    path: String,
    name: String,
    directory: bool,
    children: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryMetadata {
    remote_url: Option<String>,
    branch: String,
    revision: String,
}

#[tauri::command]
pub fn repository_metadata(path: String) -> Result<RepositoryMetadata, String> {
    let root = validate_repository(&path)?;
    let branch = git(&root, &["branch", "--show-current"])?;
    let revision = git(&root, &["rev-parse", "HEAD"])?;
    let remotes = git(&root, &["remote"])?;
    let names: Vec<&str> = remotes.lines().collect();
    let upstream = git(
        &root,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )
    .ok();
    let remote = upstream
        .as_deref()
        .filter(|name| names.contains(name))
        .or_else(|| names.iter().copied().find(|name| *name == "origin"))
        .or_else(|| {
            if names.len() == 1 {
                Some(names[0])
            } else {
                None
            }
        });
    let remote_url = remote
        .and_then(|name| git(&root, &["remote", "get-url", "--", name]).ok())
        .and_then(|url| shareable_remote_url(&url));
    Ok(RepositoryMetadata {
        remote_url,
        branch,
        revision,
    })
}

fn shareable_remote_url(raw: &str) -> Option<String> {
    let normalized = if !raw.contains("://") {
        let (host, path) = raw.split_once(':')?;
        if !host.contains('@') {
            return None;
        }
        format!("ssh://{host}/{path}")
    } else {
        raw.to_owned()
    };
    let mut url = tauri::Url::parse(&normalized).ok()?;
    if !matches!(url.scheme(), "https" | "ssh") || url.host_str().is_none() {
        return None;
    }
    // Repository config can contain personal tokens. Never send them to the form or service.
    url.set_password(None).ok()?;
    if url.scheme() == "https" {
        url.set_username("").ok()?;
    }
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string())
}

#[tauri::command]
pub fn inspect_repository(
    path: String,
    state: State<'_, RepositoryState>,
) -> Result<RepositoryInfo, String> {
    inspect_repository_data(validate_repository(&path)?, None, state)
}

#[tauri::command]
pub fn connect_repository(
    project_id: String,
    workstream_id: Option<String>,
    path: String,
    app: AppHandle,
    state: State<'_, RepositoryState>,
) -> Result<RepositoryInfo, String> {
    let root = validate_repository(&path)?;
    let connection = database(&app)?;
    connection.execute(
        "INSERT INTO repository_mappings (project_id, workstream_id, repository_path, last_opened_at) VALUES (?1, ?2, ?3, unixepoch()) ON CONFLICT(project_id, workstream_id) DO UPDATE SET repository_path=excluded.repository_path, last_opened_at=excluded.last_opened_at",
        params![project_id, mapping_key(workstream_id.as_deref()), root.to_string_lossy()],
    ).map_err(database_error)?;
    inspect_repository_data(
        root,
        last_file(&connection, &project_id, workstream_id.as_deref())?,
        state,
    )
}

#[tauri::command]
pub fn restore_repository(
    project_id: String,
    workstream_id: Option<String>,
    app: AppHandle,
    state: State<'_, RepositoryState>,
) -> Result<Option<RepositoryInfo>, String> {
    let connection = database(&app)?;
    let key = mapping_key(workstream_id.as_deref());
    let path: Option<String> = connection.query_row(
        "SELECT repository_path FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, key], |row| row.get(0),
    ).optional().map_err(database_error)?;
    let Some(path) = path else { return Ok(None) };
    let root = match validate_repository(&path) {
        Ok(root) => root,
        Err(_) => {
            connection
                .execute(
                    "DELETE FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2",
                    params![project_id, key],
                )
                .map_err(database_error)?;
            return Ok(None);
        }
    };
    inspect_repository_data(
        root,
        last_file(&connection, &project_id, workstream_id.as_deref())?,
        state,
    )
    .map(Some)
}

fn mapping_key(workstream_id: Option<&str>) -> &str {
    workstream_id.unwrap_or("")
}

fn last_file(
    connection: &Connection,
    project_id: &str,
    workstream_id: Option<&str>,
) -> Result<Option<String>, String> {
    connection.query_row(
        "SELECT last_opened_file FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, mapping_key(workstream_id)], |row| row.get(0),
    ).optional().map(|value| value.flatten()).map_err(database_error)
}

pub(super) fn inspect_repository_data(
    root: PathBuf,
    last_opened_file: Option<String>,
    state: State<'_, RepositoryState>,
) -> Result<RepositoryInfo, String> {
    let branch = git(&root, &["branch", "--show-current"])?;
    let revision = git(&root, &["rev-parse", "HEAD"])?;
    let modified = !git(&root, &["status", "--porcelain"])
        .unwrap_or_default()
        .is_empty();
    let branches = git(
        &root,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?
    .lines()
    .map(str::to_owned)
    .collect();
    let mut count = 0;
    let files = read_tree(&root, &root, &mut count)?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Repository")
        .to_string();
    *state
        .0
        .lock()
        .map_err(|_| "Repository state is unavailable.".to_string())? = Some(root.clone());
    Ok(RepositoryInfo {
        path: root.to_string_lossy().into_owned(),
        name,
        branch: if branch.is_empty() {
            "Detached HEAD".into()
        } else {
            branch
        },
        revision,
        modified,
        branches,
        files,
        last_opened_file,
    })
}
