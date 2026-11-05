//! Git-aware snapshots and filesystem identities used to recognize replayed moves.
use super::{paths::allowed, Entry};
use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    fs,
    hash::Hasher,
    io::Read,
    path::Path,
    process::Command,
};

pub(super) fn identity(meta: &fs::Metadata) -> String {
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

pub(super) fn fingerprint(path: &Path) -> Result<String, String> {
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

pub(super) fn snapshot(root: &Path) -> Result<Vec<Entry>, String> {
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
