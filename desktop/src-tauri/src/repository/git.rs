//! Local Git inspection shared by repository and worktree operations.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) fn validate_repository(path: &str) -> Result<PathBuf, String> {
    let root =
        fs::canonicalize(path).map_err(|_| "The selected folder is unavailable.".to_string())?;
    if !root.is_dir() {
        return Err("Select a folder containing a Git repository.".into());
    }
    let top_level = git(&root, &["rev-parse", "--show-toplevel"])?;
    fs::canonicalize(top_level).map_err(|_| "The repository root is unavailable.".to_string())
}

pub(super) fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|_| "Git is not installed or could not be started.".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
