use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

use crate::state::AppState;

#[derive(Serialize, Deserialize, Debug)]
pub struct Execution {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub timestamp: String,
    #[serde(rename = "pipelineType")]
    pub pipeline_type: String,
    #[serde(rename = "chapterNumber")]
    pub chapter_number: Option<serde_json::Value>,
    pub status: String,
    pub duration: Option<i64>,
}

#[tauri::command]
pub fn get_executions(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<Execution>, String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let traces_dir = Path::new(&base_dir).join(&id).join(".lisan").join("traces");

    if !traces_dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&traces_dir).map_err(|e| e.to_string())?;
    let mut jsonl_files: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".jsonl") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    jsonl_files.sort();
    jsonl_files.reverse();

    let mut executions = Vec::new();

    for file_name in &jsonl_files {
        let file_path = traces_dir.join(file_name);
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lines: Vec<&str> = content.trim().split('\n').collect();
        if lines.is_empty() {
            continue;
        }

        let first: serde_json::Value = match serde_json::from_str(lines[0]) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let last: serde_json::Value = match serde_json::from_str(lines[lines.len() - 1]) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let timestamp = file_name.trim_end_matches(".jsonl").to_string();
        let pipeline_type = first
            .get("data")
            .and_then(|d| d.get("pipeline"))
            .and_then(|p| p.as_str())
            .unwrap_or("write")
            .to_string();
        let chapter_number = first
            .get("data")
            .and_then(|d| d.get("chapter"))
            .cloned();
        let status = if last.get("level").and_then(|l| l.as_str()) == Some("error") {
            "error"
        } else {
            "completed"
        };

        let first_ts = first.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let last_ts = last.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let duration = if !first_ts.is_empty() && !last_ts.is_empty() {
            parse_duration_ms(first_ts, last_ts)
        } else {
            None
        };

        executions.push(Execution {
            id: timestamp.clone(),
            project_id: id.clone(),
            timestamp,
            pipeline_type,
            chapter_number,
            status: status.to_string(),
            duration,
        });
    }

    Ok(executions)
}

fn parse_duration_ms(start: &str, end: &str) -> Option<i64> {
    // ISO 8601 timestamps
    let parse = |s: &str| -> Option<i64> {
        // Simple: count milliseconds from epoch using chrono-like parsing
        // We'll use a basic approach: parse as RFC3339
        let s = s.replace(' ', "T");
        // Try to parse manually: YYYY-MM-DDTHH:MM:SS.mmmZ
        let dt = chrono_parse(&s)?;
        Some(dt)
    };
    let s = parse(start)?;
    let e = parse(end)?;
    Some(e - s)
}

fn chrono_parse(s: &str) -> Option<i64> {
    // Very basic ISO 8601 parser returning unix ms
    // Format: 2024-01-15T10:30:00.000Z or 2024-01-15T10:30:00Z
    let s = s.trim_end_matches('Z');
    let parts: Vec<&str> = s.splitn(2, 'T').collect();
    if parts.len() != 2 {
        return None;
    }
    let date_parts: Vec<u32> = parts[0]
        .split('-')
        .filter_map(|p| p.parse().ok())
        .collect();
    let time_str = parts[1];
    let time_main = time_str.split('.').next().unwrap_or(time_str);
    let time_parts: Vec<u32> = time_main
        .split(':')
        .filter_map(|p| p.parse().ok())
        .collect();

    if date_parts.len() < 3 || time_parts.len() < 3 {
        return None;
    }

    // Days since epoch (very rough, good enough for duration calc)
    let year = date_parts[0] as i64;
    let month = date_parts[1] as i64;
    let day = date_parts[2] as i64;
    let hour = time_parts[0] as i64;
    let min = time_parts[1] as i64;
    let sec = time_parts[2] as i64;

    // Rough days since 1970-01-01
    let y = year - 1970;
    let leap_years = (y + 1) / 4 - (y + 1) / 100 + (y + 1) / 400;
    let days_in_year = y * 365 + leap_years;
    let month_days: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let days_in_month: i64 = month_days[..((month - 1) as usize)].iter().sum();
    let total_days = days_in_year + days_in_month + day - 1;
    let ms = (total_days * 86400 + hour * 3600 + min * 60 + sec) * 1000;
    Some(ms)
}

#[tauri::command]
pub fn get_execution_detail(
    state: State<'_, AppState>,
    id: String,
    exec_id: String,
) -> Result<serde_json::Value, String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let trace_path = Path::new(&base_dir)
        .join(&id)
        .join(".lisan")
        .join("traces")
        .join(format!("{}.jsonl", exec_id));

    let content = fs::read_to_string(&trace_path).map_err(|e| e.to_string())?;

    // Return raw JSONL content for frontend to parse with jsonl-parser.ts
    Ok(serde_json::Value::String(content))
}
