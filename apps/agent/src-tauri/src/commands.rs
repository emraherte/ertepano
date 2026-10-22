//! Arayüz sayfalarının çağırdığı komutlar (window.__TAURI__.core.invoke).
use crate::agent::{agent, lock, VERSION};
use ertepano_core::model::parse_time;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

const REPORT_MAX_CHARS: usize = 2000;
const NOTE_MAX_CHARS: usize = 500;

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

/// Bu pencerenin göstermesi gereken içerik (toast / banner / badge / fs-N).
#[tauri::command]
pub fn get_view(window: WebviewWindow) -> Value {
    let ag = agent(window.app_handle());
    let g = lock(&ag.inner);
    g.views.get(window.label()).cloned().unwrap_or(Value::Null)
}

/// Kullanıcı bir duyuruda işlem yaptı: read | acked | dismissed | answered.
#[tauri::command]
pub fn act(app: AppHandle, id: String, action: String, answer: Option<String>) -> Result<(), String> {
    if !matches!(action.as_str(), "read" | "acked" | "dismissed" | "answered") {
        return Err("geçersiz işlem".into());
    }
    let ag = agent(&app);
    {
        let mut g = lock(&ag.inner);
        let item = g.items.iter().find(|i| i.a.id == id).map(|i| i.a.clone());
        if action == "dismissed" {
            if let Some(a) = item.as_ref().filter(|a| a.kind == "countdown") {
                let late = parse_time(&a.countdown_to)
                    .is_some_and(|t| t.signed_duration_since(chrono::Utc::now()).num_seconds() <= 300);
                if late {
                    g.mark_handled(&format!("{id}#late"));
                }
            }
        }
        g.mark_handled(&id);
        if g.toast_current.as_deref() == Some(id.as_str()) {
            g.toast_current = None;
        }
    }
    let mut msg = json!({ "t": "ack", "id": id, "action": action });
    if let Some(ans) = answer.filter(|a| !a.trim().is_empty()) {
        msg["answer"] = json!(clip(&ans, 200));
    }
    ag.send(msg);
    Ok(())
}

/// Acil durum yoklaması: safe | help.
#[tauri::command]
pub fn safety(app: AppHandle, emergency_id: String, status: String, note: Option<String>) -> Result<(), String> {
    if !matches!(status.as_str(), "safe" | "help") || emergency_id.is_empty() {
        return Err("geçersiz yanıt".into());
    }
    let ag = agent(&app);
    {
        let mut g = lock(&ag.inner);
        g.cache.safety.insert(emergency_id.clone(), status.clone());
        g.dirty = true;
    }
    let mut msg = json!({ "t": "safety", "emergencyId": emergency_id, "status": status });
    if let Some(n) = note.map(|n| clip(&n, NOTE_MAX_CHARS)).filter(|n| !n.is_empty()) {
        msg["note"] = json!(n);
    }
    ag.send(msg);
    Ok(())
}

/// Çalışan bildirimi (IT'ye bildir). Dönüş: şu an bağlı mı (değilse kuyrukta bekler).
#[tauri::command]
pub fn send_report(app: AppHandle, kind: String, text: String) -> Result<bool, String> {
    if kind != "it_help" {
        return Err("geçersiz bildirim türü".into());
    }
    let text = clip(&text, REPORT_MAX_CHARS);
    if text.chars().count() < 3 {
        return Err("Lütfen kısa bir açıklama yazın.".into());
    }
    let ag = agent(&app);
    ag.send(json!({ "t": "report", "kind": kind, "text": text }));
    let online = lock(&ag.inner).status.connected();
    Ok(online)
}

/// "Duyurularım" listesi (en yeni üstte).
#[tauri::command]
pub fn recent(app: AppHandle) -> Vec<Value> {
    let ag = agent(&app);
    let g = lock(&ag.inner);
    let now = chrono::Utc::now();
    g.cache
        .recent
        .iter()
        .map(|a| {
            let active = g.items.iter().any(|i| i.a.id == a.id && i.a.active(now));
            json!({ "item": a, "active": active, "handled": g.is_handled(&a.id) })
        })
        .collect()
}

#[tauri::command]
pub fn status(app: AppHandle) -> Value {
    let ag = agent(&app);
    let g = lock(&ag.inner);
    let (mode, pending, device_id, server_url) = match ag.backend.get() {
        Some(crate::backend::Backend::Direct(c)) => ("direct", c.pending(), c.device_id(), Some(c.cfg.server_url.clone())),
        Some(b) => (
            b.mode(),
            b.pending() + g.service_info.get("pending").and_then(|p| p.as_u64()).unwrap_or(0) as usize,
            g.service_info.get("deviceId").and_then(|d| d.as_str()).map(String::from),
            g.service_info.get("serverUrl").and_then(|d| d.as_str()).map(String::from),
        ),
        None => ("none", 0, None, None),
    };
    json!({
        "code": g.status.code(),
        "text": g.status.text(),
        "mode": mode,
        "serverUrl": server_url.or_else(|| ag.cfg.as_ref().map(|c| c.server_url.clone())),
        "deviceId": device_id,
        "hostname": ertepano_core::telemetry::hostname(),
        "user": ertepano_core::sys::current_user(),
        "pending": pending,
        "version": VERSION,
        "keyPinned": ag.cfg.as_ref().is_some_and(|c| !c.public_key.trim().is_empty()),
        "configSource": ag.cfg.as_ref().map(|c| c.source.clone()),
    })
}

/// Kart içeriği yüksekliğini bildirir (mantıksal px); pencere alt kenara sabit büyür/küçülür.
#[tauri::command]
pub fn fit_height(window: WebviewWindow, h: f64) {
    if window.label() != "toast" || !h.is_finite() {
        return;
    }
    let ag = agent(window.app_handle());
    lock(&ag.inner).toast_h = h.clamp(120.0, 640.0);
}

/// Tepsi pencerelerini kapat (bindirme pencereleri kapatılamaz).
#[tauri::command]
pub fn close_window(window: WebviewWindow) {
    if matches!(window.label(), "list" | "report-it" | "about") {
        let _ = window.destroy();
    }
}
