use super::*;
use crate::repository::git::git;
use std::time::{SystemTime, UNIX_EPOCH};
struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "conflux-changes-{}-{}",
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
        Self(fs::canonicalize(root).unwrap())
    }
    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        fs::write(self.0.join(path), content).unwrap();
    }
    fn git(&self, args: &[&str]) -> String {
        git(&self.0, args).unwrap()
    }
    fn commit(&self) {
        self.git(&["add", "."]);
        self.git(&["-c", "commit.gpgsign=false", "commit", "-m", "base"]);
    }
    fn diff(&self, path: &str) -> Result<FileDiff, String> {
        diff(&self.0, path, revision(&self.0).unwrap().as_deref())
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn previews_head_to_disk_without_changing_index_and_respects_ignore_rules() {
    let repo = Repo::new();
    repo.write("file.txt", "base\n");
    repo.write("deleted.txt", "removed\n");
    repo.write(".gitignore", "ignored\n");
    repo.commit();
    repo.write("file.txt", "staged\n");
    repo.git(&["add", "file.txt"]);
    repo.write("file.txt", "disk\n");
    fs::remove_file(repo.0.join("deleted.txt")).unwrap();
    repo.write("new name\nfile.txt", "new\n");
    repo.write("ignored", "hidden");
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let files = status(&repo.0).unwrap();
    assert_eq!(files.len(), 3);
    let file = files.iter().find(|file| file.path == "file.txt").unwrap();
    assert_eq!(file.index_status, "M");
    assert_eq!(file.worktree_status, "M");
    let preview = repo.diff("file.txt").unwrap();
    assert_eq!(preview.before, "base\n");
    assert_eq!(preview.after, "disk\n");
    let deleted = repo.diff("deleted.txt").unwrap();
    assert_eq!(deleted.before, "removed\n");
    assert_eq!(deleted.after, "");
    let added = repo.diff("new name\nfile.txt").unwrap();
    assert_eq!(added.before, "");
    assert_eq!(added.after, "new\n");
    assert_eq!(index, fs::read(repo.0.join(".git/index")).unwrap());
    assert!(repo.diff("ignored").is_err());
    assert!(repo.diff("../outside").is_err());
}
#[test]
fn renames_use_original_head_path_and_stale_head_is_rejected() {
    let repo = Repo::new();
    repo.write("old.txt", "base\n");
    repo.commit();
    let head = revision(&repo.0).unwrap();
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.write("new.txt", "edited\n");
    let files = status(&repo.0).unwrap();
    assert_eq!(files[0].original_path.as_deref(), Some("old.txt"));
    let preview = repo.diff("new.txt").unwrap();
    assert_eq!(preview.before, "base\n");
    assert_eq!(preview.after, "edited\n");
    repo.commit();
    repo.write("new.txt", "later\n");
    assert!(diff(&repo.0, "new.txt", head.as_deref())
        .unwrap_err()
        .contains("HEAD changed"));
}
#[test]
fn handles_unborn_and_detached_head_and_intent_to_add() {
    let repo = Repo::new();
    repo.write("new.txt", "new\n");
    assert!(revision(&repo.0).unwrap().is_none());
    assert_eq!(repo.diff("new.txt").unwrap().before, "");
    repo.git(&["add", "new.txt"]);
    assert_eq!(repo.diff("new.txt").unwrap().after, "new\n");
    repo.commit();
    repo.write("intent.txt", "intent\n");
    repo.git(&["add", "-N", "intent.txt"]);
    assert_eq!(repo.diff("intent.txt").unwrap().before, "");
    repo.git(&["checkout", "--detach"]);
    assert!(revision(&repo.0).unwrap().is_some());
}
#[test]
fn unsupported_previews_fail_without_hiding_status() {
    let repo = Repo::new();
    repo.write("binary", b"a\0b");
    repo.write("text", "base");
    repo.commit();
    repo.write("binary", b"a\0c");
    repo.write("large", vec![b'x'; MAX_BYTES as usize + 1]);
    repo.write("utf8", [0xff]);
    assert_eq!(status(&repo.0).unwrap().len(), 3);
    assert!(repo.diff("binary").unwrap_err().contains("Binary"));
    assert!(repo.diff("large").unwrap_err().contains("2 MB"));
    assert!(repo.diff("utf8").unwrap_err().contains("UTF-8"));
    repo.git(&[
        "update-index",
        "--add",
        "--cacheinfo",
        "160000",
        &repo.git(&["rev-parse", "HEAD"]),
        "module",
    ]);
    assert!(repo.diff("module").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("text", repo.0.join("link")).unwrap();
        assert!(repo.diff("link").unwrap_err().contains("Symbolic"));
    }
}
#[test]
fn conflicts_and_malformed_status_are_explicit() {
    let repo = Repo::new();
    repo.write("file", "base\n");
    repo.commit();
    repo.git(&["checkout", "-b", "other"]);
    repo.write("file", "other\n");
    repo.commit();
    repo.git(&["checkout", "main"]);
    repo.write("file", "main\n");
    repo.commit();
    assert!(git(&repo.0, &["-c", "commit.gpgsign=false", "merge", "other"]).is_err());
    assert!(repo.diff("file").unwrap_err().contains("merge conflicts"));
    assert!(parse_status(b"R  new\0").is_err());
    assert!(parse_status(b"?? \xff\0").is_err());
}
