//! Read-only status and HEAD-to-disk comparisons for the active worktree.
use super::RepositoryState;
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::State;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_STATUS_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    path: String,
    original_path: Option<String>,
    index_status: String,
    worktree_status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    branch: String,
    revision: Option<String>,
    files: Vec<Change>,
}
#[derive(Serialize, Debug)]
pub struct FileDiff {
    before: String,
    after: String,
}

fn active_root(root: &str, state: &State<'_, RepositoryState>) -> Result<PathBuf, String> {
    let active = state
        .0
        .lock()
        .map_err(|_| "Repository state is unavailable.")?;
    match active.as_ref() {
        Some(path) if path == Path::new(root) => Ok(path.clone()),
        _ => Err("The active repository changed. Reopen Changes.".into()),
    }
}

// Limit reads before allocation; do not refresh Git's index or invoke external diff tools.
fn read_git(root: &Path, args: &[&str], limit: u64) -> Result<Vec<u8>, String> {
    let mut child = Command::new("git")
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Git could not be started.")?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or("Git output is unavailable.")?
        .take(limit + 1)
        .read_to_end(&mut bytes);
    if read.is_err() || bytes.len() as u64 > limit {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Git output exceeds the preview limit.".into());
    }
    if !child
        .wait()
        .map_err(|_| "Git could not be completed.")?
        .success()
    {
        return Err(
            "Git could not read this revision or file. Refresh Changes and try again.".into(),
        );
    }
    Ok(bytes)
}

fn parse_status(bytes: &[u8]) -> Result<Vec<Change>, String> {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err("Git returned an invalid status.".into());
        }
        let path = std::str::from_utf8(&record[3..])
            .map_err(|_| "A Git filename is not valid UTF-8; inspect it with Git.")?
            .to_owned();
        let renamed = matches!(record[0], b'R' | b'C') || matches!(record[1], b'R' | b'C');
        let original_path = if renamed {
            Some(
                std::str::from_utf8(records.next().ok_or("Git returned an incomplete rename.")?)
                    .map_err(|_| "A Git filename is not valid UTF-8; inspect it with Git.")?
                    .to_owned(),
            )
        } else {
            None
        };
        files.push(Change {
            path,
            original_path,
            index_status: (record[0] as char).to_string(),
            worktree_status: (record[1] as char).to_string(),
        });
    }
    Ok(files)
}
fn status(root: &Path) -> Result<Vec<Change>, String> {
    parse_status(&read_git(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--renames",
            "--ignore-submodules=none",
        ],
        MAX_STATUS_BYTES,
    )?)
}
fn revision(root: &Path) -> Result<Option<String>, String> {
    match read_git(root, &["rev-parse", "--verify", "HEAD"], 1024) {
        Ok(value) => Ok(Some(
            String::from_utf8(value)
                .map_err(|_| "Invalid revision.")?
                .trim()
                .into(),
        )),
        Err(error) => {
            let reference = read_git(root, &["symbolic-ref", "HEAD"], 4096)?;
            let reference = std::str::from_utf8(&reference)
                .map_err(|_| "Invalid branch reference.")?
                .trim();
            // A symbolic HEAD is unborn only when its target does not exist.
            if read_git(root, &["show-ref", "--verify", reference], 4096).is_ok() {
                return Err(error);
            }
            Ok(None)
        }
    }
}
fn changes(root: &Path) -> Result<Changes, String> {
    let revision = revision(root)?;
    let files = status(root)?;
    let branch = read_git(root, &["symbolic-ref", "--short", "HEAD"], 4096)
        .ok()
        .and_then(|value| String::from_utf8(value).ok())
        .unwrap_or_else(|| "Detached HEAD".into())
        .trim()
        .into();
    if self::revision(root)? != revision {
        return Err("HEAD changed. Refresh Changes.".into());
    }
    Ok(Changes {
        branch,
        revision,
        files,
    })
}
#[tauri::command]
pub async fn repository_changes(
    root: String,
    state: State<'_, RepositoryState>,
) -> Result<Changes, String> {
    let root = active_root(&root, &state)?;
    tauri::async_runtime::spawn_blocking(move || changes(&root))
        .await
        .map_err(|_| "Git status could not be completed.")?
}
fn text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed.".into());
    }
    String::from_utf8(bytes).map_err(|_| "This file is not valid UTF-8 text.".into())
}
fn disk_text(root: &Path, path: &str) -> Result<String, String> {
    let mut file = root.to_path_buf();
    for part in Path::new(path).components() {
        if !matches!(part, Component::Normal(_)) {
            return Err("Invalid repository path.".into());
        }
        file.push(part);
        match fs::symlink_metadata(&file) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Symbolic links cannot be previewed.".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
            Err(_) => return Err("The file could not be read.".into()),
        }
    }
    let metadata = fs::metadata(&file).map_err(|_| "The file could not be read.")?;
    if !metadata.is_file() {
        return Err("Submodules and directories cannot be previewed.".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("Only text files up to 2 MB can be previewed.".into());
    }
    let canonical = fs::canonicalize(&file).map_err(|_| "The file could not be read.")?;
    if !canonical.starts_with(root) {
        return Err("The file is outside the repository.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(canonical)
        .map_err(|_| "The file could not be read.")?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The file could not be read.")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Only text files up to 2 MB can be previewed.".into());
    }
    text(bytes)
}
fn diff(root: &Path, path: &str, expected_revision: Option<&str>) -> Result<FileDiff, String> {
    let head = revision(root)?;
    if head.as_deref() != expected_revision {
        return Err("HEAD changed. Refresh Changes before comparing files.".into());
    }
    let entry = status(root)?
        .into_iter()
        .find(|entry| entry.path == path)
        .ok_or("This file no longer has changes. Refresh Changes.")?;
    let code = format!("{}{}", entry.index_status, entry.worktree_status);
    if code.contains('U') || matches!(code.as_str(), "AA" | "DD") {
        return Err(
            "This file has merge conflicts. Resolve them with Git before previewing.".into(),
        );
    }
    let index = read_git(
        root,
        &["ls-files", "--stage", "-z", "--", path],
        MAX_STATUS_BYTES,
    )?;
    if index.starts_with(b"160000 ") {
        return Err("Submodules cannot be previewed.".into());
    }
    if index.starts_with(b"120000 ") {
        return Err("Symbolic links cannot be previewed.".into());
    }
    let before = if let Some(head) = head {
        let old_path = entry.original_path.as_deref().unwrap_or(path);
        let object = format!("{head}:{old_path}");
        // An index addition (including intent-to-add) has no baseline in HEAD.
        if code == "??" || entry.index_status == "A" || entry.worktree_status == "A" {
            String::new()
        } else {
            let kind = read_git(root, &["cat-file", "-t", &object], 32)?;
            if kind != b"blob\n" {
                return Err("Submodules cannot be previewed.".into());
            }
            text(read_git(root, &["cat-file", "blob", &object], MAX_BYTES)?)?
        }
    } else {
        String::new()
    };
    let after = disk_text(root, path)?;
    if revision(root)?.as_deref() != expected_revision {
        return Err("HEAD changed. Refresh Changes before comparing files.".into());
    }
    Ok(FileDiff { before, after })
}
#[tauri::command]
pub async fn repository_file_diff(
    root: String,
    path: String,
    revision: Option<String>,
    state: State<'_, RepositoryState>,
) -> Result<FileDiff, String> {
    let root = active_root(&root, &state)?;
    tauri::async_runtime::spawn_blocking(move || diff(&root, &path, revision.as_deref()))
        .await
        .map_err(|_| "Git comparison could not be completed.")?
}

#[cfg(test)]
mod tests;
