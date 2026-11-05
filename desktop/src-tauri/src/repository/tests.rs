use super::*;
use super::{
    files::save_file,
    worktree::{add_worktree, validate_worktree_revision},
};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn autosave_checks_disk_contents_and_never_recreates_deleted_files() {
    let root = std::env::temp_dir().join(format!(
        "conflux-save-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let file = root.join("Main.java");
    fs::write(&file, "initial").unwrap();
    save_file(&file, "edited", "initial").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "edited");
    save_file(&file, "edited", "initial").unwrap();
    fs::write(&file, "external edit").unwrap();
    assert!(save_file(&file, "editor edit", "edited").is_err());
    assert_eq!(fs::read_to_string(&file).unwrap(), "external edit");
    fs::remove_file(&file).unwrap();
    assert!(save_file(&file, "editor edit", "external edit").is_err());
    assert!(!file.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn new_worktree_uses_commit_and_preserves_source_index_and_uncommitted_files() {
    let root = std::env::temp_dir().join(format!(
        "conflux-dirty-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let source = root.join("source");
    fs::create_dir_all(&source).unwrap();
    git(&source, &["init", "-b", "main"]).unwrap();
    git(&source, &["config", "user.email", "test@example.com"]).unwrap();
    git(&source, &["config", "user.name", "Test"]).unwrap();
    fs::write(source.join("file.txt"), "committed").unwrap();
    git(&source, &["add", "file.txt"]).unwrap();
    git(
        &source,
        &["-c", "commit.gpgsign=false", "commit", "-m", "base"],
    )
    .unwrap();
    let revision = git(&source, &["rev-parse", "HEAD"]).unwrap();
    fs::write(source.join("file.txt"), "staged").unwrap();
    git(&source, &["add", "file.txt"]).unwrap();
    fs::write(source.join("file.txt"), "unstaged").unwrap();
    fs::write(source.join("untracked.txt"), "local only").unwrap();
    let status = git(&source, &["status", "--porcelain"]).unwrap();
    let destination = root.join("shared");
    add_worktree(
        &source,
        destination.to_str().unwrap(),
        "conflux/team/test",
        &revision,
        true,
    )
    .unwrap();
    git(
        &source,
        &[
            "remote",
            "add",
            "origin",
            "https://user:secret@example.com/team/repo.git?token=private#secret",
        ],
    )
    .unwrap();
    let metadata = repository_metadata(source.to_string_lossy().into_owned()).unwrap();
    assert_eq!(
        metadata.remote_url.as_deref(),
        Some("https://example.com/team/repo.git")
    );
    assert_eq!(metadata.branch, "main");
    assert_eq!(metadata.revision, revision);
    assert!(destination.join(".git").is_file());
    let linked = repository_metadata(destination.to_string_lossy().into_owned()).unwrap();
    assert_eq!(linked.remote_url, metadata.remote_url);
    assert_eq!(linked.branch, "conflux/team/test");
    assert_eq!(linked.revision, revision);
    git(
        &source,
        &[
            "remote",
            "add",
            "upstream",
            "git@example.com:other/repo.git",
        ],
    )
    .unwrap();
    git(&source, &["config", "branch.main.remote", "upstream"]).unwrap();
    assert_eq!(
        repository_metadata(source.to_string_lossy().into_owned())
            .unwrap()
            .remote_url
            .as_deref(),
        Some("ssh://git@example.com/other/repo.git")
    );
    assert_eq!(
        fs::read_to_string(destination.join("file.txt")).unwrap(),
        "committed"
    );
    assert!(!destination.join("untracked.txt").exists());
    assert!(git(&destination, &["status", "--porcelain"])
        .unwrap()
        .is_empty());
    assert_eq!(git(&source, &["status", "--porcelain"]).unwrap(), status);
    assert_eq!(git(&source, &["show", ":file.txt"]).unwrap(), "staged");
    assert_eq!(
        fs::read_to_string(source.join("file.txt")).unwrap(),
        "unstaged"
    );
    assert_eq!(
        fs::read_to_string(source.join("untracked.txt")).unwrap(),
        "local only"
    );
    assert_eq!(git(&source, &["branch", "--show-current"]).unwrap(), "main");
    assert_eq!(git(&source, &["rev-parse", "HEAD"]).unwrap(), revision);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn detected_remote_never_exposes_embedded_credentials_or_local_paths() {
    assert_eq!(
        shareable_remote_url("https://token@example.com/repo.git?key=secret"),
        Some("https://example.com/repo.git".into())
    );
    assert_eq!(
        shareable_remote_url("ssh://git:secret@example.com:2222/repo.git"),
        Some("ssh://git@example.com:2222/repo.git".into())
    );
    assert_eq!(
        shareable_remote_url("git@example.com:team/repo.git"),
        Some("ssh://git@example.com/team/repo.git".into())
    );
    assert_eq!(shareable_remote_url("file:///tmp/repo"), None);
    assert_eq!(shareable_remote_url("/tmp/repo"), None);
    assert_eq!(shareable_remote_url("http://example.com/repo"), None);
}

#[test]
fn shared_branch_requires_the_exact_revision_without_changing_local_work() {
    let root = std::env::temp_dir().join(format!(
        "conflux-shared-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "-b", "main"]).unwrap();
    git(&root, &["config", "user.email", "test@example.com"]).unwrap();
    git(&root, &["config", "user.name", "Test"]).unwrap();
    git(
        &root,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "base",
        ],
    )
    .unwrap();
    let base = git(&root, &["rev-parse", "HEAD"]).unwrap();
    fs::create_dir_all(root.join("src/nested")).unwrap();
    assert_eq!(
        validate_repository(root.join("src/nested").to_str().unwrap()).unwrap(),
        fs::canonicalize(&root).unwrap()
    );
    git(&root, &["branch", "conflux/team/test"]).unwrap();
    assert!(validate_worktree_revision(&root, "conflux/team/test", &base, false).is_ok());
    assert!(validate_worktree_revision(&root, "conflux/team/new", &base, true).is_ok());
    git(
        &root,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "later",
        ],
    )
    .unwrap();
    let later = git(&root, &["rev-parse", "HEAD"]).unwrap();
    fs::write(root.join("local.txt"), "keep my work").unwrap();
    assert!(
        validate_worktree_revision(&root, "conflux/team/test", &later, false)
            .unwrap_err()
            .contains("differs")
    );
    assert!(validate_worktree_revision(&root, "conflux/team/test", "HEAD", true).is_err());
    assert!(
        validate_worktree_revision(&root, "conflux/team/test", &"0".repeat(40), true)
            .unwrap_err()
            .contains("unavailable")
    );
    assert_eq!(git(&root, &["rev-parse", "HEAD"]).unwrap(), later);
    assert_eq!(
        git(&root, &["rev-parse", "conflux/team/test"]).unwrap(),
        base
    );
    assert_eq!(
        fs::read_to_string(root.join("local.txt")).unwrap(),
        "keep my work"
    );
    fs::remove_dir_all(root).unwrap();
}
