//! Create isolated worktrees at the exact shared revision.
use super::{
    git::{git, validate_repository},
    inspect_repository_data, RepositoryInfo, RepositoryState,
};
use crate::storage::{database, database_error};
use rusqlite::{params, OptionalExtension};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn create_worktree(
    project_id: String,
    workstream_id: String,
    branch_name: String,
    base_revision: String,
    create_branch: bool,
    app: AppHandle,
    state: State<'_, RepositoryState>,
) -> Result<RepositoryInfo, String> {
    let connection = database(&app)?;
    let source: Option<String> = connection.query_row(
        "SELECT repository_path FROM repository_mappings WHERE project_id=?1 AND workstream_id=''",
        params![project_id], |row| row.get(0),
    ).optional().map_err(database_error)?;
    let source = validate_repository(
        &source.ok_or_else(|| "Connect a local repository first.".to_string())?,
    )?;
    validate_identifier(&project_id, "project")?;
    validate_identifier(&workstream_id, "workstream")?;

    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Application storage is unavailable.".to_string())?
        .join("worktrees")
        .join(&project_id)
        .join(&workstream_id);
    if root.exists() {
        return Err("A local worktree already exists for this workstream.".into());
    }
    fs::create_dir_all(
        root.parent()
            .ok_or_else(|| "The worktree location is invalid.".to_string())?,
    )
    .map_err(|_| "The worktree folder could not be created.".to_string())?;
    let destination = root.to_string_lossy().into_owned();
    add_worktree(
        &source,
        &destination,
        &branch_name,
        &base_revision,
        create_branch,
    )?;

    if let Err(error) = connection.execute(
        "INSERT INTO repository_mappings (project_id, workstream_id, repository_path, last_opened_at) VALUES (?1, ?2, ?3, unixepoch()) ON CONFLICT(project_id, workstream_id) DO UPDATE SET repository_path=excluded.repository_path, last_opened_at=excluded.last_opened_at",
        params![project_id, workstream_id, destination],
    ) {
        let _ = git(&source, &["worktree", "remove", "--force", &destination]);
        if create_branch { let _ = git(&source, &["branch", "-D", &branch_name]); }
        return Err(database_error(error));
    }
    inspect_repository_data(root, None, state)
}

// A separate worktree reads committed objects without changing the source worktree or index.
pub(super) fn add_worktree(
    source: &Path,
    destination: &str,
    branch_name: &str,
    base_revision: &str,
    create_branch: bool,
) -> Result<(), String> {
    validate_worktree_revision(source, branch_name, base_revision, create_branch)?;
    let result = if create_branch {
        git(
            source,
            &[
                "worktree",
                "add",
                "-b",
                branch_name,
                destination,
                base_revision,
            ],
        )
    } else {
        git(source, &["worktree", "add", destination, branch_name])
    };
    if let Err(error) = result {
        return Err(if error.contains("already checked out") {
            "That branch is already open in another worktree.".into()
        } else {
            error
        });
    }
    Ok(())
}

pub(super) fn validate_worktree_revision(
    source: &Path,
    branch: &str,
    revision: &str,
    create_branch: bool,
) -> Result<(), String> {
    git(source, &["check-ref-format", "--branch", branch])
        .map_err(|_| "Enter a valid Git branch name.".to_string())?;
    if !matches!(revision.len(), 40 | 64) || !revision.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The shared revision must be a full Git commit ID.".into());
    }
    let expected = git(
        source,
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
    )
    .map_err(|_| {
        "The shared revision is unavailable locally. Fetch the project repository and retry."
            .to_string()
    })?;
    if !create_branch {
        let actual = git(
            source,
            &[
                "rev-parse",
                "--verify",
                &format!("refs/heads/{branch}^{{commit}}"),
            ],
        )?;
        if actual != expected {
            return Err("This local branch differs from the shared revision. Reconcile it with the team before opening files. Your local changes have been preserved.".into());
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("The {label} identifier is invalid."));
    }
    Ok(())
}
