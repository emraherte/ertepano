//! Duyuru görselleri. Webview'in CSP'si dış adreslere kapalıdır (img-src 'self' data: blob:) — böylece kötü niyetli
//! bir görsel adresi (ör. \\saldırgan\paylaşım ya da http://iç-sunucu) Windows'un NTLM kimlik bilgisini sızdıramaz.
//! Görseller burada, yalnızca yapılandırılmış ErtePano sunucusunun kökeninden ve /media/ altından indirilir,
//! boyut/tür sınırıyla data: URL'e çevrilip sayfaya öyle verilir.
use base64::{engine::general_purpose::STANDARD, Engine};
use ertepano_core::lock;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_ENTRIES: usize = 32;
const TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

#[derive(Clone)]
enum Slot {
    Loading,
    Ready(String),
    Failed,
}

struct State {
    origin: reqwest::Url,
    cache: Mutex<HashMap<String, Slot>>,
}

static STATE: OnceLock<State> = OnceLock::new();

/// Sunucu kökenini ayarla (yapılandırmadaki serverUrl). Ayarlanmazsa hiçbir görsel gösterilmez.
pub fn init(server_url: &str) {
    if let Ok(origin) = reqwest::Url::parse(server_url) {
        let _ = STATE.set(State { origin, cache: Mutex::new(HashMap::new()) });
    }
}

/// Yalnızca sunucuyla aynı köken (şema + ana bilgisayar + bağlantı noktası) ve /media/<ad>.<uzantı>
fn allowed(st: &State, url: &str) -> Option<reqwest::Url> {
    let u = reqwest::Url::parse(url).ok()?;
    let same = u.scheme() == st.origin.scheme() && u.host_str() == st.origin.host_str() && u.port_or_known_default() == st.origin.port_or_known_default();
    let path = u.path();
    let ok_path = path.starts_with("/media/")
        && !path.contains("..")
        && [".png", ".jpg", ".jpeg", ".gif", ".webp"].iter().any(|e| path.to_ascii_lowercase().ends_with(e));
    (same && ok_path && u.query().is_none() && u.username().is_empty()).then_some(u)
}

/// Hazırsa data: URL; değilse None (indirme arka planda başlar, gösterim döngüsü bir sonraki tikte yeniden sorar).
pub fn resolve(url: &str) -> Option<String> {
    let st = STATE.get()?;
    if let Some(slot) = lock(&st.cache).get(url).cloned() {
        return match slot {
            Slot::Ready(d) => Some(d),
            _ => None,
        };
    }
    let Some(u) = allowed(st, url) else {
        ertepano_core::log::log(&format!("görsel reddedildi (sunucu dışı köken veya yol): {url}"));
        lock(&st.cache).insert(url.to_string(), Slot::Failed);
        return None;
    };
    {
        let mut c = lock(&st.cache);
        if c.len() >= MAX_ENTRIES {
            c.clear();
        }
        c.insert(url.to_string(), Slot::Loading);
    }
    let key = url.to_string();
    tauri::async_runtime::spawn(async move {
        let slot = match fetch(u).await {
            Ok(d) => Slot::Ready(d),
            Err(e) => {
                ertepano_core::log::log(&format!("görsel indirilemedi: {e}"));
                Slot::Failed
            }
        };
        if let Some(st) = STATE.get() {
            lock(&st.cache).insert(key, slot);
        }
    });
    None
}

async fn fetch(u: reqwest::Url) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(u).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let ct = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !TYPES.contains(&ct.as_str()) {
        return Err(format!("izin verilmeyen tür: {ct}"));
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("görsel çok büyük".into());
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("görsel çok büyük".into());
    }
    Ok(format!("data:{ct};base64,{}", STANDARD.encode(&bytes)))
}
