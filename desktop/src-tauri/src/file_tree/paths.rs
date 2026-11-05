//! Shared-tree path policy and active-repository boundary checks.
use crate::repository::RepositoryState;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn allowed(path: &str) -> bool {
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

pub(super) fn safe_path(root: &Path, path: &str) -> Result<PathBuf, String> {
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

pub(super) fn check_root(root: &str, state: &RepositoryState) -> Result<PathBuf, String> {
    let selected = state.0.lock().map_err(|e| e.to_string())?;
    let root = PathBuf::from(root);
    if selected.as_ref() != Some(&root) {
        return Err("The active repository changed. Reopen the workspace.".into());
    }
    Ok(root)
}
