use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

use crate::state::AppState;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Serialize)]
pub struct FileBrowseResult {
    pub entries: Option<Vec<FileEntry>>,
    pub content: Option<String>,
    pub is_dir: bool,
}

#[tauri::command]
pub fn browse_files(
    state: State<'_, AppState>,
    id: String,
    subpath: String,
) -> Result<FileBrowseResult, String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let project_root = Path::new(&base_dir).join(&id);

    // 路径穿越防护
    if subpath.contains("..") {
        return Err("非法路径".to_string());
    }

    let target = if subpath.is_empty() {
        project_root.clone()
    } else {
        project_root.join(&subpath)
    };

    // 确保目标路径在项目根目录内
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    let canonical_root = project_root.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("非法路径".to_string());
    }

    if canonical_target.is_dir() {
        let entries = fs::read_dir(&canonical_target).map_err(|e| e.to_string())?;
        let mut file_entries: Vec<FileEntry> = entries
            .flatten()
            .map(|e| {
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let size = if is_dir {
                    None
                } else {
                    e.metadata().ok().map(|m| m.len())
                };
                let rel_path = e
                    .path()
                    .strip_prefix(&canonical_root)
                    .unwrap_or(&e.path())
                    .to_string_lossy()
                    .to_string();
                FileEntry {
                    name: e.file_name().to_string_lossy().to_string(),
                    path: rel_path,
                    is_dir,
                    size,
                }
            })
            .collect();
        file_entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.cmp(&b.name))
        });
        Ok(FileBrowseResult {
            entries: Some(file_entries),
            content: None,
            is_dir: true,
        })
    } else {
        let content = fs::read_to_string(&canonical_target).map_err(|e| e.to_string())?;
        Ok(FileBrowseResult {
            entries: None,
            content: Some(content),
            is_dir: false,
        })
    }
}
