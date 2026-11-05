mod document;
mod file_tree;
mod repository;
mod storage;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(repository::RepositoryState::default())
        .invoke_handler(tauri::generate_handler![
            document::document_load,
            document::document_save,
            repository::download::download_repository,
            file_tree::file_tree_snapshot,
            file_tree::file_tree_baseline,
            file_tree::file_tree_load,
            file_tree::file_tree_save,
            file_tree::file_tree_apply,
            file_tree::file_tree_content,
            repository::connect_repository,
            repository::worktree::create_worktree,
            repository::inspect_repository,
            repository::repository_metadata,
            repository::restore_repository,
            repository::files::read_repository_file,
            repository::files::write_repository_file,
            workspace::remember_open_file,
            workspace::save_last_workspace,
            workspace::load_last_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Conflux");
}
