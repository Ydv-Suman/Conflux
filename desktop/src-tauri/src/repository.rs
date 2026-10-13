use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, process::Command, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 10_000;

#[derive(Default)]
pub struct RepositoryState(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    path: String,
    name: String,
    branch: String,
    revision: String,
    modified: bool,
    branches: Vec<String>,
    files: Vec<FileEntry>,
    last_opened_file: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    path: String,
    name: String,
    directory: bool,
    children: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastWorkspace {
    project_id: String,
    team_id: String,
    workstream_id: Option<String>,
}

#[tauri::command]
pub fn inspect_repository(path: String, state: State<'_, RepositoryState>) -> Result<RepositoryInfo, String> {
    inspect_repository_data(validate_repository(&path)?, None, state)
}

#[tauri::command]
pub fn connect_repository(project_id: String, workstream_id: Option<String>, path: String, app: AppHandle, state: State<'_, RepositoryState>) -> Result<RepositoryInfo, String> {
    let root = validate_repository(&path)?;
    let connection = database(&app)?;
    connection.execute(
        "INSERT INTO repository_mappings (project_id, workstream_id, repository_path, last_opened_at) VALUES (?1, ?2, ?3, unixepoch()) ON CONFLICT(project_id, workstream_id) DO UPDATE SET repository_path=excluded.repository_path, last_opened_at=excluded.last_opened_at",
        params![project_id, mapping_key(workstream_id.as_deref()), root.to_string_lossy()],
    ).map_err(database_error)?;
    inspect_repository_data(root, last_file(&connection, &project_id, workstream_id.as_deref())?, state)
}

#[tauri::command]
pub fn restore_repository(project_id: String, workstream_id: Option<String>, app: AppHandle, state: State<'_, RepositoryState>) -> Result<Option<RepositoryInfo>, String> {
    let connection = database(&app)?;
    let key = mapping_key(workstream_id.as_deref());
    let path: Option<String> = connection.query_row(
        "SELECT repository_path FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, key], |row| row.get(0),
    ).optional().map_err(database_error)?;
    let Some(path) = path else { return Ok(None) };
    let root = match validate_repository(&path) {
        Ok(root) => root,
        Err(_) => {
            connection.execute("DELETE FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2", params![project_id, key]).map_err(database_error)?;
            return Ok(None);
        }
    };
    inspect_repository_data(root, last_file(&connection, &project_id, workstream_id.as_deref())?, state).map(Some)
}

#[tauri::command]
pub fn remember_open_file(project_id: String, workstream_id: String, path: String, app: AppHandle) -> Result<(), String> {
    database(&app)?.execute(
        "UPDATE repository_mappings SET last_opened_file=?3, last_opened_at=unixepoch() WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, workstream_id, path],
    ).map_err(database_error)?;
    Ok(())
}

#[tauri::command]
pub fn save_last_workspace(project_id: String, team_id: String, workstream_id: Option<String>, app: AppHandle) -> Result<(), String> {
    database(&app)?.execute(
        "INSERT INTO app_state (id, project_id, team_id, workstream_id) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, team_id=excluded.team_id, workstream_id=excluded.workstream_id",
        params![project_id, team_id, workstream_id],
    ).map_err(database_error)?;
    Ok(())
}

#[tauri::command]
pub fn load_last_workspace(app: AppHandle) -> Result<Option<LastWorkspace>, String> {
    database(&app)?.query_row(
        "SELECT project_id, team_id, workstream_id FROM app_state WHERE id=1", [],
        |row| Ok(LastWorkspace { project_id: row.get(0)?, team_id: row.get(1)?, workstream_id: row.get(2)? }),
    ).optional().map_err(database_error)
}

#[tauri::command]
pub fn read_repository_file(path: String, state: State<'_, RepositoryState>) -> Result<String, String> {
    let file = resolve_file(&path, &state)?;
    let metadata = fs::metadata(&file).map_err(|_| "The file is unavailable.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES { return Err("Only text files up to 2 MB can be opened.".into()) }
    fs::read_to_string(file).map_err(|_| "This file is not valid UTF-8 text.".to_string())
}

#[tauri::command]
pub fn write_repository_file(path: String, content: String, state: State<'_, RepositoryState>) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES { return Err("Only text files up to 2 MB can be saved.".into()) }
    let file = resolve_file(&path, &state)?;
    if !file.is_file() { return Err("The file is unavailable.".into()) }
    fs::write(file, content).map_err(|_| "The file could not be saved.".to_string())
}

fn database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app.path().app_data_dir().map_err(|_| "Application storage is unavailable.".to_string())?;
    fs::create_dir_all(&directory).map_err(|_| "Application storage could not be created.".to_string())?;
    let connection = Connection::open(directory.join("conflux.sqlite3")).map_err(database_error)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS repository_mappings (project_id TEXT NOT NULL, workstream_id TEXT NOT NULL, repository_path TEXT NOT NULL, last_opened_file TEXT, last_opened_at INTEGER NOT NULL, PRIMARY KEY (project_id, workstream_id));
         CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), project_id TEXT NOT NULL, team_id TEXT NOT NULL, workstream_id TEXT);",
    ).map_err(database_error)?;
    Ok(connection)
}

fn mapping_key(workstream_id: Option<&str>) -> &str { workstream_id.unwrap_or("") }

fn last_file(connection: &Connection, project_id: &str, workstream_id: Option<&str>) -> Result<Option<String>, String> {
    connection.query_row(
        "SELECT last_opened_file FROM repository_mappings WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, mapping_key(workstream_id)], |row| row.get(0),
    ).optional().map(|value| value.flatten()).map_err(database_error)
}

fn validate_repository(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|_| "The selected folder is unavailable.".to_string())?;
    if !root.is_dir() { return Err("Select a folder containing a Git repository.".into()) }
    git(&root, &["rev-parse", "--is-inside-work-tree"])?;
    Ok(root)
}

fn inspect_repository_data(root: PathBuf, last_opened_file: Option<String>, state: State<'_, RepositoryState>) -> Result<RepositoryInfo, String> {
    let branch = git(&root, &["branch", "--show-current"])?;
    let revision = git(&root, &["rev-parse", "HEAD"])?;
    let modified = !git(&root, &["status", "--porcelain"]).unwrap_or_default().is_empty();
    let branches = git(&root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?.lines().map(str::to_owned).collect();
    let mut count = 0;
    let files = read_tree(&root, &root, &mut count)?;
    let name = root.file_name().and_then(|value| value.to_str()).unwrap_or("Repository").to_string();
    *state.0.lock().map_err(|_| "Repository state is unavailable.".to_string())? = Some(root.clone());
    Ok(RepositoryInfo { path: root.to_string_lossy().into_owned(), name, branch: if branch.is_empty() { "Detached HEAD".into() } else { branch }, revision, modified, branches, files, last_opened_file })
}

fn resolve_file(path: &str, state: &State<'_, RepositoryState>) -> Result<PathBuf, String> {
    let root = state.0.lock().map_err(|_| "Repository state is unavailable.".to_string())?.clone().ok_or_else(|| "Connect a local repository first.".to_string())?;
    let relative = Path::new(path);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) { return Err("The file path is outside the connected repository.".into()) }
    let file = fs::canonicalize(root.join(relative)).map_err(|_| "The file is unavailable.".to_string())?;
    if !file.starts_with(&root) { return Err("The file path is outside the connected repository.".into()) }
    Ok(file)
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git").arg("-C").arg(root).args(args).output().map_err(|_| "Git is not installed or could not be started.".to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()) }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn read_tree(root: &Path, directory: &Path, count: &mut usize) -> Result<Vec<FileEntry>, String> {
    let mut entries = fs::read_dir(directory).map_err(|_| "The repository could not be read.".to_string())?.filter_map(Result::ok)
        .filter(|entry| !matches!(entry.file_name().to_str(), Some(".git" | "node_modules" | "target" | "dist"))).collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.path().is_dir(), entry.file_name()));
    let mut result = Vec::new();
    for entry in entries {
        let file_type = entry.file_type().map_err(|_| "The repository tree is invalid.".to_string())?;
        if file_type.is_symlink() { continue }
        *count += 1;
        if *count > MAX_TREE_ENTRIES { return Err("This repository contains too many files to display.".into()) }
        let path = entry.path();
        let directory = file_type.is_dir();
        let relative = path.strip_prefix(root).map_err(|_| "The repository tree is invalid.".to_string())?;
        result.push(FileEntry { path: relative.to_string_lossy().replace('\\', "/"), name: entry.file_name().to_string_lossy().into_owned(), directory, children: if directory { read_tree(root, &path, count)? } else { Vec::new() } });
    }
    Ok(result)
}

fn database_error(error: rusqlite::Error) -> String { format!("Local workspace storage failed: {error}") }
