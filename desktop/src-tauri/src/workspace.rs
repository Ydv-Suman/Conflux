//! Device-local workspace selection and last-opened-file preferences.
use crate::storage::{database, database_error};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastWorkspace {
    project_id: String,
    team_id: String,
    workstream_id: Option<String>,
}

#[tauri::command]
pub fn remember_open_file(
    project_id: String,
    workstream_id: String,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    database(&app)?.execute(
        "UPDATE repository_mappings SET last_opened_file=?3, last_opened_at=unixepoch() WHERE project_id=?1 AND workstream_id=?2",
        params![project_id, workstream_id, path],
    ).map_err(database_error)?;
    Ok(())
}

#[tauri::command]
pub fn save_last_workspace(
    project_id: String,
    team_id: String,
    workstream_id: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    database(&app)?.execute(
        "INSERT INTO app_state (id, project_id, team_id, workstream_id) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, team_id=excluded.team_id, workstream_id=excluded.workstream_id",
        params![project_id, team_id, workstream_id],
    ).map_err(database_error)?;
    Ok(())
}

#[tauri::command]
pub fn load_last_workspace(app: AppHandle) -> Result<Option<LastWorkspace>, String> {
    database(&app)?
        .query_row(
            "SELECT project_id, team_id, workstream_id FROM app_state WHERE id=1",
            [],
            |row| {
                Ok(LastWorkspace {
                    project_id: row.get(0)?,
                    team_id: row.get(1)?,
                    workstream_id: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(database_error)
}
