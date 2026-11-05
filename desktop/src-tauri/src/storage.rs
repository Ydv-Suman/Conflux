//! Shared application database connection and bootstrap schema.
use rusqlite::Connection;
use std::fs;
use tauri::{AppHandle, Manager};

pub(crate) fn database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Application storage is unavailable.".to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|_| "Application storage could not be created.".to_string())?;
    let connection = Connection::open(directory.join("conflux.sqlite3")).map_err(database_error)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS repository_mappings (project_id TEXT NOT NULL, workstream_id TEXT NOT NULL, repository_path TEXT NOT NULL, last_opened_file TEXT, last_opened_at INTEGER NOT NULL, PRIMARY KEY (project_id, workstream_id));
         CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), project_id TEXT NOT NULL, team_id TEXT NOT NULL, workstream_id TEXT);",
    ).map_err(database_error)?;
    Ok(connection)
}

pub(crate) fn database_error(error: rusqlite::Error) -> String {
    format!("Local workspace storage failed: {error}")
}
