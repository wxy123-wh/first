use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

use crate::state::AppState;

#[derive(Serialize, Deserialize, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    #[serde(rename = "chapterCount")]
    pub chapter_count: usize,
    #[serde(rename = "lastExecutionTime")]
    pub last_execution_time: Option<String>,
}

struct ProjectSummary {
    chapter_count: usize,
    last_execution_time: Option<String>,
    status: String,
}

impl ProjectSummary {
    fn idle() -> Self {
        Self {
            chapter_count: 0,
            last_execution_time: None,
            status: "idle".to_string(),
        }
    }
}

fn normalize_project_status(raw_status: Option<&str>) -> String {
    match raw_status.map(|status| status.trim().to_ascii_lowercase()) {
        Some(status) if status == "running" || status == "pending" => "running".to_string(),
        Some(status) if status == "completed" => "completed".to_string(),
        Some(status) if status == "failed" || status == "error" => "failed".to_string(),
        _ => "idle".to_string(),
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> bool {
    connection
        .query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table_name],
            |row| row.get::<_, i64>(0),
        )
        .ok()
        .is_some_and(|count| count > 0)
}

fn load_project_summary(project_path: &Path) -> ProjectSummary {
    let db_path = project_path.join(".lisan").join("lisan.db");
    if !db_path.exists() {
        return ProjectSummary::idle();
    }

    let connection = match Connection::open(db_path) {
        Ok(connection) => connection,
        Err(_) => return ProjectSummary::idle(),
    };

    let mut summary = ProjectSummary::idle();

    if table_exists(&connection, "chapters") {
        let chapter_count = connection
            .query_row("SELECT COUNT(1) FROM chapters", [], |row| {
                row.get::<_, i64>(0)
            })
            .ok()
            .unwrap_or(0);
        summary.chapter_count = usize::try_from(chapter_count).ok().unwrap_or(0);
    }

    if !table_exists(&connection, "executions") {
        return summary;
    }

    let latest_execution = connection
        .query_row(
            r#"
              SELECT status, COALESCE(completedAt, startedAt) AS executedAt
              FROM executions
              ORDER BY COALESCE(completedAt, startedAt) DESC
              LIMIT 1
            "#,
            [],
            |row| {
                let status: String = row.get(0)?;
                let executed_at: Option<String> = row.get(1)?;
                Ok((status, executed_at))
            },
        )
        .optional()
        .ok()
        .flatten();

    if let Some((status, executed_at)) = latest_execution {
        summary.status = normalize_project_status(Some(status.as_str()));
        summary.last_execution_time = executed_at;
    }

    summary
}

#[derive(Deserialize, Debug)]
pub struct LlmProviderConfig {
    pub provider: String,
    pub model: String,
    pub temperature: f64,
}

#[derive(Deserialize, Debug)]
pub struct LlmConfig {
    pub orchestrator: Option<LlmProviderConfig>,
    pub worker: Option<LlmProviderConfig>,
}

#[derive(Deserialize, Debug)]
pub struct CreateProjectInput {
    pub name: String,
    pub plugin: Option<String>,
    #[serde(rename = "llmConfig")]
    pub llm_config: Option<LlmConfig>,
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let base_path = state.workspace_root.as_path();

    let mut projects = Vec::new();

    let entries = fs::read_dir(base_path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let project_path = entry.path();
        let lisan_dir = project_path.join(".lisan");
        let has_legacy_config = lisan_dir.join("config.yaml").exists();
        let has_current_config = project_path.join("lisan.config.yaml").exists();
        if !has_legacy_config && !has_current_config {
            continue;
        }

        let summary = load_project_summary(&project_path);

        let id = entry.file_name().to_string_lossy().to_string();
        projects.push(Project {
            name: id.clone(),
            path: project_path.to_string_lossy().to_string(),
            status: summary.status,
            chapter_count: summary.chapter_count,
            last_execution_time: summary.last_execution_time,
            id,
        });
    }

    Ok(projects)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    data: CreateProjectInput,
) -> Result<Project, String> {
    let project_root = state.workspace_root.join(&data.name);

    if project_root.exists() {
        return Err("项目已存在".to_string());
    }

    let dirs = [
        "大纲",
        "设定集",
        "场景树",
        "正文",
        ".lisan/tmp",
        ".lisan/traces",
    ];

    for d in &dirs {
        fs::create_dir_all(project_root.join(d)).map_err(|e| e.to_string())?;
    }

    let plugin = data.plugin.as_deref().unwrap_or("webnovel");
    let orch_provider = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.provider.as_str())
        .unwrap_or("anthropic");
    let orch_model = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.model.as_str())
        .unwrap_or("claude-opus-4-20250514");
    let orch_temp = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.temperature)
        .unwrap_or(0.7);
    let worker_provider = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.provider.as_str())
        .unwrap_or("openai");
    let worker_model = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.model.as_str())
        .unwrap_or("gpt-4o");
    let worker_temp = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.temperature)
        .unwrap_or(0.85);

    let config_content = format!(
        r#"version: "1"
book:
  id: "{name}"
  title: "{name}"
  plugin: "{plugin}"

llm:
  orchestrator:
    provider: {orch_provider}
    model: {orch_model}
    temperature: {orch_temp}
  worker:
    provider: {worker_provider}
    model: {worker_model}
    temperature: {worker_temp}

rag:
  provider: lancedb
  embedModel: text-embedding-v3
  embedBaseUrl: ${{EMBED_BASE_URL}}
  embedApiKey: ${{EMBED_API_KEY}}

pipeline:
  write:
    chapterWordRange: [3000, 4000]
    passes: [pass-1, pass-2, pass-3, pass-4, pass-5]
    autoGitCommit: true
"#,
        name = data.name,
        plugin = plugin,
        orch_provider = orch_provider,
        orch_model = orch_model,
        orch_temp = orch_temp,
        worker_provider = worker_provider,
        worker_model = worker_model,
        worker_temp = worker_temp,
    );

    fs::write(project_root.join("lisan.config.yaml"), &config_content)
        .map_err(|e| e.to_string())?;
    fs::write(
        project_root.join(".lisan").join("config.yaml"),
        &config_content,
    )
    .map_err(|e| e.to_string())?;

    let sample_outline = format!(
        "# {} - 故事大纲\n\n## 第一卷：起始\n\n### 第一章\n- 主角登场\n- 引入核心冲突\n\n### 第二章\n- 世界观展开\n- 关键角色出场\n",
        data.name
    );
    fs::write(project_root.join("大纲").join("arc-1.md"), &sample_outline)
        .map_err(|e| e.to_string())?;

    Ok(Project {
        id: data.name.clone(),
        name: data.name.clone(),
        path: project_root.to_string_lossy().to_string(),
        status: "idle".to_string(),
        chapter_count: 0,
        last_execution_time: None,
    })
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let lisan_dir = state.workspace_root.join(&id).join(".lisan");

    if !lisan_dir.exists() {
        return Err("项目不存在".to_string());
    }

    fs::remove_dir_all(&lisan_dir).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_project_dir(suffix: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be monotonic")
            .as_nanos();
        path.push(format!("lisan-projects-{suffix}-{nonce}"));
        path
    }

    #[test]
    fn normalize_project_status_maps_known_statuses() {
        assert_eq!(normalize_project_status(Some("running")), "running");
        assert_eq!(normalize_project_status(Some("pending")), "running");
        assert_eq!(normalize_project_status(Some("completed")), "completed");
        assert_eq!(normalize_project_status(Some("failed")), "failed");
        assert_eq!(normalize_project_status(Some("error")), "failed");
        assert_eq!(normalize_project_status(None), "idle");
        assert_eq!(normalize_project_status(Some("unknown")), "idle");
    }

    #[test]
    fn load_project_summary_reads_from_db() {
        let project_dir = unique_temp_project_dir("summary");
        let lisan_dir = project_dir.join(".lisan");
        fs::create_dir_all(&lisan_dir).expect("failed to create .lisan directory");
        let db_path = lisan_dir.join("lisan.db");
        let conn = Connection::open(&db_path).expect("failed to open sqlite db");
        conn.execute_batch(
            r#"
              CREATE TABLE chapters (
                id TEXT PRIMARY KEY
              );
              CREATE TABLE executions (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                startedAt TEXT NOT NULL,
                completedAt TEXT
              );
            "#,
        )
        .expect("failed to create test tables");
        conn.execute("INSERT INTO chapters (id) VALUES ('c1')", [])
            .expect("insert chapter c1");
        conn.execute("INSERT INTO chapters (id) VALUES ('c2')", [])
            .expect("insert chapter c2");
        conn.execute(
            "INSERT INTO executions (id, status, startedAt, completedAt) VALUES (?1, ?2, ?3, ?4)",
            (
                "e1",
                "completed",
                "2026-01-01T10:00:00.000Z",
                "2026-01-01T10:05:00.000Z",
            ),
        )
        .expect("insert execution e1");
        conn.execute(
            "INSERT INTO executions (id, status, startedAt, completedAt) VALUES (?1, ?2, ?3, ?4)",
            (
                "e2",
                "failed",
                "2026-01-02T08:00:00.000Z",
                "2026-01-02T08:01:00.000Z",
            ),
        )
        .expect("insert execution e2");
        drop(conn);

        let summary = load_project_summary(&project_dir);
        assert_eq!(summary.chapter_count, 2);
        assert_eq!(summary.status, "failed");
        assert_eq!(
            summary.last_execution_time.as_deref(),
            Some("2026-01-02T08:01:00.000Z")
        );

        fs::remove_dir_all(&project_dir).expect("cleanup test directory");
    }

    #[test]
    fn load_project_summary_defaults_to_idle_when_db_missing() {
        let project_dir = unique_temp_project_dir("missing-db");
        fs::create_dir_all(&project_dir).expect("failed to create project directory");

        let summary = load_project_summary(&project_dir);
        assert_eq!(summary.chapter_count, 0);
        assert_eq!(summary.status, "idle");
        assert!(summary.last_execution_time.is_none());

        fs::remove_dir_all(&project_dir).expect("cleanup test directory");
    }
}
