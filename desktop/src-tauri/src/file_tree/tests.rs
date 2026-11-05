use super::scan::{fingerprint, identity};
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{collections::HashSet, path::PathBuf};
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
