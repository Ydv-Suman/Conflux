use crate::repository::{connect_repository, RepositoryInfo, RepositoryState};
use serde::Deserialize;
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, State, Url};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AccessMode { Public, HttpsCredentialHelper, SshAgent }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    project_id: String,
    project_name: String,
    parent_path: String,
    repository_url: String,
    access_mode: AccessMode,
    canonical_branch: String,
    canonical_revision: String,
    checkout_branch: String,
    checkout_revision: String,
}

#[tauri::command]
pub async fn download_repository(
    request: DownloadRequest, app: AppHandle, state: State<'_, RepositoryState>,
) -> Result<RepositoryInfo, String> {
    let project_id = request.project_id.clone();
    let root = tauri::async_runtime::spawn_blocking(move || download(&request)).await
        .map_err(|_| "The download could not finish. Try again.".to_string())??;
    connect_repository(project_id, None, root.to_string_lossy().into_owned(), app, state)
}

fn validate(request: &DownloadRequest) -> Result<(), String> {
    if request.project_id.is_empty() || request.project_id.len() > 128
        || !request.project_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("The project identifier is invalid.".into());
    }
    let url = Url::parse(&request.repository_url).map_err(|_| "The repository URL is invalid.".to_string())?;
    let valid_access = match request.access_mode {
        AccessMode::Public | AccessMode::HttpsCredentialHelper => url.scheme() == "https" && url.username().is_empty(),
        AccessMode::SshAgent => url.scheme() == "ssh" && !url.username().is_empty()
            && url.username().bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)),
    };
    if !valid_access || request.repository_url.len() > 2048 || request.repository_url.chars().any(|c| c.is_whitespace() || c.is_control())
        || url.host_str().is_none() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || url.path().len() < 2 || url.port() == Some(0) {
        return Err("Use a credential-free HTTPS or SSH repository URL matching its access mode.".into());
    }
    for revision in [&request.canonical_revision, &request.checkout_revision] {
        if !matches!(revision.len(), 40 | 64) || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("The shared revision must be a full Git commit ID. Ask a project manager to update the repository settings.".into());
        }
    }
    for branch in [&request.canonical_branch, &request.checkout_branch] {
        if branch.is_empty() || branch.len() > 200 || branch.starts_with('-') || branch.starts_with('@') {
            return Err("The shared branch name is invalid.".into());
        }
        run(git_command(&request.access_mode).args(["check-ref-format", "--branch", branch]), "The shared branch name is invalid.")?;
    }
    Ok(())
}

fn git_command(mode: &AccessMode) -> Command {
    let mut command = Command::new("git");
    for key in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"] {
        command.env_remove(key);
    }
    command.env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never")
        .env("GIT_ASKPASS", "").env("SSH_ASKPASS", "")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args(["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always",
            "-c", "http.followRedirects=false", "-c", "core.hooksPath=/dev/null"]);
    if matches!(mode, AccessMode::Public) {
        command.env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" })
            .args(["-c", "credential.helper=", "-c", "http.extraHeader="]);
    }
    command
}

// Keep network Git off the UI thread and bound hangs without exposing credential-helper output.
fn run(command: &mut Command, failure: &str) -> Result<(), String> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Git could not start. Install Git and try again.".to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return if status.success() { Ok(()) } else { Err(failure.into()) },
            Ok(None) if start.elapsed() < Duration::from_secs(180) => thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill(); let _ = child.wait();
                return Err("Git timed out. Check your connection and Git credentials, then retry.".into());
            }
        }
    }
}

fn project_folder_name(name: &str) -> Result<String, String> {
    // A project name is one portable path component, never a path supplied to Git.
    let sanitized: String = name.chars().map(|c| {
        if c.is_control() || "<>:\"/\\|?*".contains(c) { '-' } else { c }
    }).collect();
    let mut name = sanitized.trim_matches(|c: char| c.is_whitespace() || c == '.').to_string();
    if name.is_empty() || name.len() > 240 {
        return Err("The project name cannot be used as a folder name. Rename the project with a shorter, non-empty name.".into());
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| stem.strip_prefix(prefix)
            .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))) {
        name.insert(0, '_');
    }
    Ok(name)
}

fn download(request: &DownloadRequest) -> Result<PathBuf, String> {
    let folder_name = project_folder_name(&request.project_name)?;
    validate(request)?;
    let parent = fs::canonicalize(&request.parent_path).map_err(|_| "Choose an existing download folder.".to_string())?;
    if !parent.is_dir() { return Err("Choose a folder for the download.".into()); }
    let destination = parent.join(folder_name);
    clone_into(request, &destination, git_command(&request.access_mode))?;
    Ok(destination)
}

fn clone_into(request: &DownloadRequest, destination: &Path, mut command: Command) -> Result<(), String> {
    // Reserve a new directory; never overwrite an existing clone or the user's files.
    fs::create_dir(destination).map_err(|_| "The project folder already exists or cannot be created. Choose another location, or connect the existing local folder.".to_string())?;
    let result = (|| {
        run(command.args(["clone", "--no-checkout", "--no-local", "--template=", "--origin", "origin", "--branch", &request.canonical_branch,
            "--", &request.repository_url]).arg(destination),
            "Download failed. Check the repository URL, branch, and provider access. For private repositories, configure your Git credential helper or SSH agent and known host first.")?;
        prepare_checkout(request, destination)
    })();
    if result.is_err() { let _ = fs::remove_dir_all(destination); }
    result
}

fn prepare_checkout(request: &DownloadRequest, root: &Path) -> Result<(), String> {
    run(git_command(&request.access_mode).arg("-C").arg(root).args(["merge-base", "--is-ancestor", &request.canonical_revision,
        &format!("refs/remotes/origin/{}", request.canonical_branch)]),
        "The configured project revision is not on the remote canonical branch. Ask a manager to publish it or update repository settings.")?;
    run(git_command(&request.access_mode).arg("-C").arg(root).args(["cat-file", "-e", &format!("{}^{{commit}}", request.checkout_revision)]),
        "The shared workspace revision is missing from the remote. Ask a team manager to push that commit, then retry.")?;
    // This is a newly owned clone; existing repositories never pass through this checkout.
    run(git_command(&request.access_mode).arg("-C").arg(root).args(["checkout", "-B", &request.checkout_branch, &request.checkout_revision]),
        "The downloaded shared branch could not be checked out.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn request() -> DownloadRequest {
        DownloadRequest { project_id: "project-1".into(), project_name: "Iris Predictor".into(), parent_path: String::new(),
            repository_url: "https://git.example.com/team/project.git".into(), access_mode: AccessMode::Public,
            canonical_branch: "main".into(), canonical_revision: "a".repeat(40),
            checkout_branch: "conflux/team/team-1".into(), checkout_revision: "a".repeat(40) }
    }

    #[test]
    fn project_names_become_safe_folders_without_ids() {
        for (name, expected) in [
            ("iris-predictor", "iris-predictor"), (" Iris Predictor. ", "Iris Predictor"),
            ("预测项目", "预测项目"), ("../../outside", "-..-outside"),
            ("C:\\repo/name?", "C--repo-name-"), ("CON.txt", "_CON.txt"),
            ("lpt1", "_lpt1"), ("COM¹", "_COM¹"), ("CON .txt", "_CON .txt"),
            ("line\nbreak", "line-break"),
        ] {
            let folder = project_folder_name(name).unwrap();
            assert_eq!(folder, expected);
            assert_eq!(Path::new(&folder).components().count(), 1);
            assert!(!Path::new(&folder).is_absolute());
        }
        for name in ["", " . . ", &"a".repeat(241), &"项".repeat(81)] {
            assert!(project_folder_name(name).is_err());
        }
    }

    #[test]
    fn rejects_unsafe_download_arguments_before_creating_files() {
        assert!(validate(&request()).is_ok());
        for url in ["file:///tmp/repo", "/tmp/repo", "http://example.com/repo", "ext::command",
            "https://token@example.com/repo", "https://user:token@example.com/repo", "https://example.com/repo?token=secret",
            "https://example.com/repo#secret", "https://example.com/", "https://example.com/repo\nother"] {
            let mut r = request(); r.repository_url = url.into(); assert!(validate(&r).is_err(), "{url}");
        }
        let mut r = request(); r.project_id = "../outside".into(); assert!(validate(&r).is_err());
        for branch in ["--upload-pack=command", "../main", "a..b", "main/", "@{-1}"] {
            let mut r = request(); r.checkout_branch = branch.into(); assert!(validate(&r).is_err());
        }
        let mut r = request(); r.checkout_revision = "HEAD".into(); assert!(validate(&r).is_err());
        r = request(); r.access_mode = AccessMode::SshAgent;
        r.repository_url = "ssh://git@example.com/team/repo.git".into(); assert!(validate(&r).is_ok());
        r.repository_url = "ssh://git:secret@example.com/team/repo.git".into(); assert!(validate(&r).is_err());
    }

    fn git(root: &Path, args: &[&str]) -> String {
        let output = Command::new("git").arg("-C").arg(root).args(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"])
            .args(args).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).trim().into()
    }

    #[test]
    fn clones_and_checks_out_exact_shared_commit_without_overwriting_existing_files() {
        let root = std::env::temp_dir().join(format!("conflux-download-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let source = root.join("source"); fs::create_dir_all(&source).unwrap();
        git(&source, &["init", "-b", "main"]);
        git(&source, &["config", "user.name", "Test"]); git(&source, &["config", "user.email", "test@example.com"]);
        fs::write(source.join("file.txt"), "canonical").unwrap();
        git(&source, &["add", "."]); git(&source, &["commit", "-m", "canonical"]);
        let canonical = git(&source, &["rev-parse", "HEAD"]);
        git(&source, &["checkout", "-b", "conflux/team/team-1"]);
        fs::write(source.join("file.txt"), "shared work").unwrap();
        git(&source, &["commit", "-am", "shared"]);
        let shared = git(&source, &["rev-parse", "HEAD"]);
        git(&source, &["checkout", "main"]);
        fs::write(source.join("uncommitted.txt"), "keep this").unwrap();
        let mut r = request(); r.repository_url = source.to_string_lossy().into(); r.canonical_revision = canonical;
        r.checkout_revision = shared.clone();
        let target = root.join(project_folder_name(&r.project_name).unwrap());
        // Test only: a local transport exercises real Git without external credentials or network access.
        clone_into(&r, &target, Command::new("git")).unwrap();
        assert_eq!(git(&target, &["branch", "--show-current"]), r.checkout_branch);
        assert_eq!(git(&target, &["rev-parse", "HEAD"]), shared);
        assert_eq!(fs::read_to_string(target.join("file.txt")).unwrap(), "shared work");
        fs::write(target.join("my-work.txt"), "keep my download").unwrap();
        assert!(clone_into(&r, &target, Command::new("git")).is_err());
        assert_eq!(fs::read_to_string(target.join("my-work.txt")).unwrap(), "keep my download");
        assert_eq!(fs::read_to_string(source.join("uncommitted.txt")).unwrap(), "keep this");
        let missing = root.join("missing"); r.checkout_revision = "0".repeat(40);
        assert!(clone_into(&r, &missing, Command::new("git")).unwrap_err().contains("missing"));
        assert!(!missing.exists());
        r.checkout_revision = shared.clone(); r.canonical_revision = shared;
        assert!(clone_into(&r, &missing, Command::new("git")).unwrap_err().contains("canonical branch"));
        assert!(!missing.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn private_git_uses_noninteractive_credentials_and_public_git_ignores_user_credentials() {
        let private = git_command(&AccessMode::HttpsCredentialHelper);
        let env = private.get_envs().map(|(key, value)| (key.to_string_lossy().into_owned(), value.map(|v| v.to_string_lossy().into_owned()))).collect::<std::collections::HashMap<_, _>>();
        assert_eq!(env["GIT_TERMINAL_PROMPT"].as_deref(), Some("0"));
        assert_eq!(env["GCM_INTERACTIVE"].as_deref(), Some("never"));
        assert_eq!(env["GIT_DIR"], None);
        let public = git_command(&AccessMode::Public);
        assert!(public.get_envs().any(|(key, value)| key == "GIT_CONFIG_GLOBAL" && value.is_some()));
        assert!(public.get_args().any(|arg| arg == "protocol.allow=never"));
    }
}
