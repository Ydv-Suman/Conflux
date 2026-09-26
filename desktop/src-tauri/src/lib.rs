use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicUsize, Ordering}, Mutex},
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

struct DocumentStore {
    path: PathBuf,
    updates: Mutex<Vec<Vec<u8>>>,
}

fn decode_updates(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let mut updates = Vec::new();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let length_bytes: [u8; 4] = bytes
            .get(cursor..cursor + 4)
            .ok_or("truncated update length")?
            .try_into()
            .map_err(|_| "invalid update length")?;
        let length = u32::from_le_bytes(length_bytes) as usize;
        cursor += 4;
        let update = bytes
            .get(cursor..cursor + length)
            .ok_or("truncated document update")?;
        updates.push(update.to_vec());
        cursor += length;
    }

    Ok(updates)
}

fn append_update(path: &Path, update: &[u8]) -> Result<(), String> {
    let length = u32::try_from(update.len()).map_err(|_| "document update is too large")?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&length.to_le_bytes())
        .and_then(|_| file.write_all(update))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_document_updates(store: State<'_, DocumentStore>) -> Result<Vec<Vec<u8>>, String> {
    store
        .updates
        .lock()
        .map(|updates| updates.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn send_document_update(
    app: tauri::AppHandle,
    store: State<'_, DocumentStore>,
    update: Vec<u8>,
) -> Result<(), String> {
    append_update(&store.path, &update)?;
    store
        .updates
        .lock()
        .map_err(|error| error.to_string())?
        .push(update.clone());

    // ponytail: append-only log; compact into a Yjs snapshot when document logs become large.
    app.emit("document:update", update)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_second_window(app: tauri::AppHandle) -> Result<(), String> {
    static WINDOW_ID: AtomicUsize = AtomicUsize::new(1);
    let label = format!("editor-{}", WINDOW_ID.fetch_add(1, Ordering::Relaxed));

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title("Conflux")
        .inner_size(940.0, 680.0)
        .min_inner_size(620.0, 460.0)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            let path = directory.join("shared-document.updates");
            let updates = match fs::read(&path) {
                Ok(bytes) => decode_updates(&bytes).map_err(std::io::Error::other)?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
                Err(error) => return Err(error.into()),
            };
            app.manage(DocumentStore {
                path,
                updates: Mutex::new(updates),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_document_updates,
            send_document_update,
            open_second_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conflux");
}

#[cfg(test)]
mod tests {
    use super::decode_updates;

    #[test]
    fn decodes_framed_updates() {
        let bytes = [2_u32.to_le_bytes().as_slice(), &[1, 2], 1_u32.to_le_bytes().as_slice(), &[3]].concat();
        assert_eq!(decode_updates(&bytes), Ok(vec![vec![1, 2], vec![3]]));
        assert!(decode_updates(&bytes[..bytes.len() - 1]).is_err());
    }
}
