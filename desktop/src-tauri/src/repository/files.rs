//! Local editor reads, guarded writes, and the initial Explorer tree.
use super::{FileEntry, RepositoryState};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 10_000;

#[tauri::command]
pub fn read_repository_file(
    path: String,
    state: State<'_, RepositoryState>,
) -> Result<String, String> {
    let file = resolve_file(&path, &state, None)?;
    let metadata = fs::metadata(&file).map_err(|_| "The file is unavailable.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("Only text files up to 2 MB can be opened.".into());
    }
    fs::read_to_string(file).map_err(|_| "This file is not valid UTF-8 text.".to_string())
}

#[tauri::command]
pub fn write_repository_file(
    path: String,
    content: String,
    previous_content: String,
    root: String,
    state: State<'_, RepositoryState>,
) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("Only text files up to 2 MB can be saved.".into());
    }
    let file = resolve_file(&path, &state, Some(&root))?;
    if !file.is_file() {
        return Err("The file is unavailable.".into());
    }
    save_file(&file, &content, &previous_content)
}

pub(super) fn save_file(file: &Path, content: &str, previous_content: &str) -> Result<(), String> {
    let current = fs::read_to_string(file)
        .map_err(|_| "The file could not be read before saving.".to_string())?;
    if current != previous_content && current != content {
        return Err("This file changed on disk. Copy your editor changes, then reopen the file to reconcile them. The disk contents were preserved.".into());
    }
    if current == content {
        return Ok(());
    }
    fs::write(file, content).map_err(|_| "The file could not be saved.".to_string())
}

fn resolve_file(
    path: &str,
    state: &State<'_, RepositoryState>,
    expected_root: Option<&str>,
) -> Result<PathBuf, String> {
    let root = state
        .0
        .lock()
        .map_err(|_| "Repository state is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "Connect a local repository first.".to_string())?;
    if expected_root.is_some_and(|expected| Path::new(expected) != root) {
        return Err("The active repository changed before the file could be saved.".into());
    }
    let relative = Path::new(path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("The file path is outside the connected repository.".into());
    }
    let file = fs::canonicalize(root.join(relative))
        .map_err(|_| "The file is unavailable.".to_string())?;
    if !file.starts_with(&root) {
        return Err("The file path is outside the connected repository.".into());
    }
    Ok(file)
}

pub(super) fn read_tree(
    root: &Path,
    directory: &Path,
    count: &mut usize,
) -> Result<Vec<FileEntry>, String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|_| "The repository could not be read.".to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | "node_modules" | "target" | "dist")
            )
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.path().is_dir(), entry.file_name()));
    let mut result = Vec::new();
    for entry in entries {
        let file_type = entry
            .file_type()
            .map_err(|_| "The repository tree is invalid.".to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        *count += 1;
        if *count > MAX_TREE_ENTRIES {
            return Err("This repository contains too many files to display.".into());
        }
        let path = entry.path();
        let directory = file_type.is_dir();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "The repository tree is invalid.".to_string())?;
        result.push(FileEntry {
            path: relative.to_string_lossy().replace('\\', "/"),
            name: entry.file_name().to_string_lossy().into_owned(),
            directory,
            children: if directory {
                read_tree(root, &path, count)?
            } else {
                Vec::new()
            },
        });
    }
    Ok(result)
}
