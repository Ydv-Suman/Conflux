use crate::repository::database;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

fn prepare(db: &Connection) -> Result<(), String> {
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS document_state (scope TEXT PRIMARY KEY, value TEXT NOT NULL);")
        .map_err(|e| e.to_string())
}
fn load(db: &Connection, scope: &str) -> Result<Option<String>, String> {
    prepare(db)?;
    db.query_row("SELECT value FROM document_state WHERE scope=?1", [scope], |row| row.get(0))
        .optional().map_err(|e| e.to_string())
}
fn save(db: &Connection, scope: &str, value: &str) -> Result<(), String> {
    if scope.is_empty() || scope.len() > 8192 || value.len() > 64 * 1024 * 1024 {
        return Err("Document recovery state exceeds the local storage limit.".into());
    }
    prepare(db)?;
    // Snapshot and pending updates commit together; no receipt can clear half a record.
    db.execute("INSERT INTO document_state(scope,value) VALUES(?1,?2)
        ON CONFLICT(scope) DO UPDATE SET value=excluded.value", params![scope, value])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn document_load(app: AppHandle, scope: String) -> Result<Option<String>, String> {
    load(&database(&app)?, &scope)
}
#[tauri::command]
pub fn document_save(app: AppHandle, scope: String, value: String) -> Result<(), String> {
    save(&database(&app)?, &scope, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_survives_reopen_and_is_scoped_and_atomic() {
        let path = std::env::temp_dir().join(format!("conflux-document-{}-{}.sqlite", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let db = Connection::open(&path).unwrap();
            save(&db, "user-a/document", "snapshot-and-pending").unwrap();
            save(&db, "user-b/document", "other-user").unwrap();
        }
        {
            let db = Connection::open(&path).unwrap();
            assert_eq!(load(&db, "user-a/document").unwrap().as_deref(), Some("snapshot-and-pending"));
            save(&db, "user-a/document", "acknowledged-snapshot").unwrap();
            assert_eq!(load(&db, "user-a/document").unwrap().as_deref(), Some("acknowledged-snapshot"));
            assert_eq!(load(&db, "user-b/document").unwrap().as_deref(), Some("other-user"));
            assert_eq!(load(&db, "other-document").unwrap(), None);
            assert!(save(&db, "", "invalid").is_err());
        }
        std::fs::remove_file(path).unwrap();
    }
}
