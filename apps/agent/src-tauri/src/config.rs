//! agent.json (kurulum yapılandırması) ve device.json (kayıt sonrası kimlik) — bkz. docs/PROTOKOL.md §1.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub server_url: String,
    pub enroll_key: String,
    /// Sunucunun Ed25519 genel anahtarı (base64, 32 bayt). Boşsa ilk kayıtta güvenilir (TOFU).
    pub public_key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceFile {
    pub device_id: String,
    pub device_secret: String,
    /// TOFU ile sabitlenen genel anahtar (agent.json'da anahtar yoksa)
    pub public_key: String,
    /// Kaydın yapıldığı sunucu; agent.json başka sunucuya işaret ederse yeniden kayıt olunur
    pub server_url: String,
}

/// %APPDATA%\ErtePano
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("ErtePano");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Arama sırası: %ProgramData%\ErtePano\agent.json → exe yanındaki agent.json → ERTEPANO_CONFIG.
fn candidates() -> Vec<PathBuf> {
    let mut out = vec![];
    if let Some(pd) = std::env::var_os("ProgramData") {
        out.push(PathBuf::from(pd).join("ErtePano").join("agent.json"));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        out.push(dir.join("agent.json"));
    }
    if let Some(p) = std::env::var_os("ERTEPANO_CONFIG") {
        out.push(PathBuf::from(p));
    }
    out
}

pub fn load() -> Option<Config> {
    for path in candidates() {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        match serde_json::from_str::<Config>(text.trim_start_matches('\u{feff}')) {
            Ok(mut c) => {
                c.server_url = c.server_url.trim().trim_end_matches('/').to_string();
                if c.server_url.is_empty() {
                    crate::log::log(&format!("{}: serverUrl boş", path.display()));
                    continue;
                }
                crate::log::log(&format!("yapılandırma: {}", path.display()));
                return Some(c);
            }
            Err(e) => crate::log::log(&format!("{} okunamadı: {e}", path.display())),
        }
    }
    None
}

fn device_path() -> PathBuf {
    data_dir().join("device.json")
}

pub fn load_device() -> Option<DeviceFile> {
    let text = std::fs::read_to_string(device_path()).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_device(d: &DeviceFile) {
    if let Ok(text) = serde_json::to_string_pretty(d) {
        let _ = std::fs::write(device_path(), text);
    }
}

/// Kimliği unut ama TOFU anahtarını koru (yeniden kayıtta sahte sunucu anahtarı kabul edilmesin).
pub fn clear_device(keep_key: &str) {
    if keep_key.is_empty() {
        let _ = std::fs::remove_file(device_path());
    } else {
        save_device(&DeviceFile { public_key: keep_key.to_string(), ..Default::default() });
    }
}
