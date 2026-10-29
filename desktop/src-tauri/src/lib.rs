mod repository;
mod download;
mod file_tree;
mod document;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(repository::RepositoryState::default())
        .invoke_handler(tauri::generate_handler![
            document::document_load,
            document::document_save,
            download::download_repository,
            file_tree::file_tree_snapshot,
            file_tree::file_tree_baseline,
            file_tree::file_tree_load,
            file_tree::file_tree_save,
            file_tree::file_tree_apply,
            file_tree::file_tree_content,
            repository::connect_repository,
            repository::create_worktree,
            repository::inspect_repository,
            repository::repository_metadata,
            repository::restore_repository,
            repository::read_repository_file,
            repository::write_repository_file,
            repository::remember_open_file,
            repository::save_last_workspace,
            repository::load_last_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conflux");
}
