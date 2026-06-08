//! TaskExporter — Asana via a Personal Access Token (SPEC §9). Fetches
//! workspaces/projects/users and creates tasks from a note's action items with
//! assignee, due date, and a link back to the meeting. The returned task gid is
//! stored on action_items so the UI shows "sent" and avoids duplicates.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::Db;
use crate::keychain;

const API: &str = "https://app.asana.com/api/1.0";

fn token() -> Result<String, String> {
    keychain::get("asana_access_token")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "No Asana token — add it in Settings.".to_string())
}

#[derive(Serialize)]
pub struct IdName {
    gid: String,
    name: String,
}

#[derive(Serialize)]
pub struct AsanaUser {
    gid: String,
    name: String,
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIn {
    pub action_item_id: String,
    pub text: String,
    pub assignee_gid: Option<String>,
    pub due_on: Option<String>,
}

async fn get(path: &str) -> Result<Value, String> {
    let tok = token()?;
    let resp = Client::new()
        .get(format!("{API}{path}"))
        .bearer_auth(tok)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(format!("Asana API error: {}", v));
    }
    Ok(v)
}

#[tauri::command]
pub async fn asana_workspaces() -> Result<Vec<IdName>, String> {
    let v = get("/users/me?opt_fields=workspaces.name").await?;
    Ok(v["data"]["workspaces"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|w| {
                    Some(IdName {
                        gid: w["gid"].as_str()?.to_string(),
                        name: w["name"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub async fn asana_projects(workspace: String) -> Result<Vec<IdName>, String> {
    let v = get(&format!(
        "/projects?workspace={workspace}&archived=false&opt_fields=name&limit=100"
    ))
    .await?;
    Ok(parse_id_names(&v))
}

#[tauri::command]
pub async fn asana_users(workspace: String) -> Result<Vec<AsanaUser>, String> {
    let v = get(&format!(
        "/users?workspace={workspace}&opt_fields=name,email&limit=100"
    ))
    .await?;
    Ok(v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|u| {
                    Some(AsanaUser {
                        gid: u["gid"].as_str()?.to_string(),
                        name: u["name"].as_str().unwrap_or("").to_string(),
                        email: u["email"].as_str().map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

fn parse_id_names(v: &Value) -> Vec<IdName> {
    v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    Some(IdName {
                        gid: p["gid"].as_str()?.to_string(),
                        name: p["name"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Create one Asana task per item, then persist the returned gids on the
/// matching action_items rows. Returns how many tasks were created.
#[tauri::command]
pub async fn asana_create_tasks(
    db: State<'_, Db>,
    note_id: String,
    project_gid: String,
    workspace: String,
    items: Vec<TaskIn>,
) -> Result<usize, String> {
    // Read the meeting title up front (don't hold the lock across awaits).
    let meeting_title: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT title FROM notes WHERE id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .unwrap_or_default()
    };
    let notes_link = format!("Created by Glyph from meeting: {meeting_title}");
    let tok = token()?;
    let client = Client::new();

    let mut created: Vec<(String, String)> = Vec::new(); // (action_item_id, task_gid)
    for item in &items {
        let mut data = json!({
            "name": item.text,
            "notes": notes_link,
            "projects": [project_gid],
            "workspace": workspace,
        });
        if let Some(a) = &item.assignee_gid {
            if !a.is_empty() {
                data["assignee"] = json!(a);
            }
        }
        if let Some(d) = &item.due_on {
            if !d.is_empty() {
                data["due_on"] = json!(d);
            }
        }

        let resp = client
            .post(format!("{API}/tasks"))
            .bearer_auth(&tok)
            .json(&json!({ "data": data }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let ok = resp.status().is_success();
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        if !ok {
            return Err(format!("Asana create task failed: {}", v));
        }
        if let Some(gid) = v["data"]["gid"].as_str() {
            created.push((item.action_item_id.clone(), gid.to_string()));
        }
    }

    // Persist gids after all network work is done.
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (ai_id, gid) in &created {
        let _ = conn.execute(
            "UPDATE action_items SET asana_gid = ?2 WHERE id = ?1",
            rusqlite::params![ai_id, gid],
        );
    }
    Ok(created.len())
}
