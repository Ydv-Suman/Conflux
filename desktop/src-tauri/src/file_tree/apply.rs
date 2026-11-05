//! Apply shared operations while preserving conflicting and deleted local content.
use super::{
    paths::safe_path,
    scan::{fingerprint, identity},
    Change,
};
use std::{fs, io::Write, path::Path};

pub(super) fn apply(root: &Path, recovery: &Path, change: &Change) -> Result<(), String> {
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
