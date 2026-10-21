//! Arayüz çekirdeği: doğrulanmış duyurular, kullanıcıya özel önbellek (okundu/yanıtlar) ve gösterim durumu.
//! Sunucu bağlantısı ya Windows hizmetinde (boru) ya da bu süreçte (Direct, geliştirme) yaşar — bkz. backend.rs.
use crate::backend::Backend;
use crate::win::PhysRect;
use ertepano_core::client::Status;
use ertepano_core::config::{self, Config};
use ertepano_core::model::{Announcement, Item, SignedItem};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};

pub use ertepano_core::{lock, VERSION};

const SEEN_MAX: usize = 500;
const RECENT_MAX: usize = 30;

pub fn agent(app: &AppHandle) -> Arc<Agent> {
    app.state::<Arc<Agent>>().inner().clone()
}

/// %APPDATA%\ErtePano\cache.json — çevrimdışıyken de gösterim ve kullanıcının işlemleri için.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Cache {
    /// Aktif duyuruların imzalı hâli (açılışta yeniden doğrulanır)
    pub items: Vec<SignedItem>,
    /// Kullanıcının işlem yaptığı id'ler (okudu / onayladı / kapattı / yanıtladı) — tekrar gösterilmez
    pub handled: Vec<String>,
    /// "seen" bildirimi gönderilmiş id'ler
    pub seen: Vec<String>,
    /// "Duyurularım" listesi
    pub recent: Vec<Announcement>,
    /// Acil durum yoklama yanıtları: emergencyId → safe | help
    pub safety: HashMap<String, String>,
}

pub struct Inner {
    pub status: Status,
    pub items: Vec<Item>,
    pub cache: Cache,
    pub dirty: bool,
    /// Hizmetin bildirdiği genel anahtar (hizmet modunda, yapılandırmada anahtar yoksa)
    pub service_key: Option<String>,
    /// Hizmetin bildirdiği bilgiler (cihaz kimliği, sunucu, bekleyen mesaj)
    pub service_info: Value,
    // gösterim durumu (display.rs)
    pub views: HashMap<String, Value>,
    pub open: HashMap<String, (isize, PhysRect)>,
    pub toast_current: Option<String>,
    pub toast_since: Option<Instant>,
    pub toast_h: f64,
    pub hover: HashMap<String, bool>,
}

impl Inner {
    pub fn is_handled(&self, key: &str) -> bool {
        self.cache.handled.iter().any(|h| h == key)
    }

    pub fn mark_handled(&mut self, key: &str) {
        if !self.is_handled(key) {
            self.cache.handled.push(key.to_string());
            cap(&mut self.cache.handled, SEEN_MAX);
            self.dirty = true;
        }
    }

    /// true = ilk kez görüldü (çağıran "seen" bildirimi gönderir)
    pub fn mark_seen(&mut self, id: &str) -> bool {
        if self.cache.seen.iter().any(|s| s == id) {
            return false;
        }
        self.cache.seen.push(id.to_string());
        cap(&mut self.cache.seen, SEEN_MAX);
        self.dirty = true;
        true
    }

    fn remember(&mut self, a: &Announcement) {
        self.cache.recent.retain(|r| r.id != a.id);
        self.cache.recent.insert(0, a.clone());
        self.cache.recent.truncate(RECENT_MAX);
    }
}

fn cap(v: &mut Vec<String>, max: usize) {
    if v.len() > max {
        let n = v.len() - max;
        v.drain(0..n);
    }
}

pub struct Agent {
    pub cfg: Option<Config>,
    /// Windows hizmeti başlattı (`--managed`): yalnızca boru, tepside "Çıkış" yok
    pub managed: bool,
    pub inner: Mutex<Inner>,
    pub backend: OnceLock<Backend>,
    pub status_item: OnceLock<MenuItem<Wry>>,
    pub sys: Mutex<sysinfo::System>,
}

fn cache_path() -> std::path::PathBuf {
    config::user_data().join("cache.json")
}

impl Agent {
    pub fn load(managed: bool) -> Agent {
        let cfg = config::load();
        let cache: Cache = std::fs::read_to_string(cache_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let inner = Inner {
            status: Status::Starting,
            items: vec![],
            cache,
            dirty: false,
            service_key: None,
            service_info: Value::Null,
            views: HashMap::new(),
            open: HashMap::new(),
            toast_current: None,
            toast_since: None,
            toast_h: 220.0,
            hover: HashMap::new(),
        };
        Agent {
            cfg,
            managed,
            inner: Mutex::new(inner),
            backend: OnceLock::new(),
            status_item: OnceLock::new(),
            sys: Mutex::new(ertepano_core::telemetry::new_system()),
        }
    }

    /// Önbellekteki duyuruları yeniden doğrula (süresi dolan / eski acil yükler düşer). Backend seçildikten sonra çağrılır.
    pub fn restore_cached(&self) {
        let mut g = lock(&self.inner);
        let cached = std::mem::take(&mut g.cache.items);
        if let Some(key) = self.key(&g) {
            for s in cached {
                if let Ok(a) = ertepano_core::verify::verify(&key, &s) {
                    g.items.push(Item { signed: s, a });
                }
            }
        }
    }

    /// İmza doğrulama anahtarı: yapılandırmada sabitlenmiş → hizmetin bildirdiği → (Direct) istemcinin TOFU anahtarı.
    pub fn key(&self, g: &Inner) -> Option<String> {
        if let Some(k) = self.cfg.as_ref().map(|c| c.public_key.trim().to_string()).filter(|k| !k.is_empty()) {
            return Some(k);
        }
        match self.backend.get() {
            Some(Backend::Direct(c)) => c.key(),
            _ => g.service_key.clone(),
        }
    }

    fn check(&self, g: &Inner, s: &SignedItem) -> Option<Announcement> {
        let Some(key) = self.key(g) else {
            ertepano_core::log::log("genel anahtar yok — duyuru gösterilmeyecek");
            return None;
        };
        match ertepano_core::verify::verify(&key, s) {
            Ok(a) => Some(a),
            Err(e) => {
                ertepano_core::log::log(&format!("duyuru reddedildi: {e}"));
                None
            }
        }
    }

    /// "sync": tam liste — listede olmayan kaldırılır.
    pub fn apply_sync(&self, list: Vec<SignedItem>) {
        let mut g = lock(&self.inner);
        let mut items = vec![];
        for s in list {
            if let Some(a) = self.check(&g, &s) {
                g.remember(&a);
                items.push(Item { signed: s, a });
            }
        }
        g.items = items;
        g.dirty = true;
    }

    /// "show": yeni veya güncellenmiş duyuru.
    pub fn upsert(&self, s: SignedItem) {
        let mut g = lock(&self.inner);
        let Some(a) = self.check(&g, &s) else { return };
        g.remember(&a);
        let item = Item { signed: s, a };
        match g.items.iter_mut().find(|i| i.a.id == item.a.id) {
            Some(slot) => *slot = item,
            None => g.items.push(item),
        }
        g.dirty = true;
    }

    /// "revoke": duyuru bitti → ekrandan kalkar.
    pub fn revoke(&self, id: &str) {
        let mut g = lock(&self.inner);
        g.items.retain(|i| i.a.id != id);
        if g.toast_current.as_deref() == Some(id) {
            g.toast_current = None;
        }
        g.dirty = true;
    }

    /// Ajan → sunucu mesajı (ack / safety / report): hizmete ya da doğrudan istemciye.
    pub fn send(&self, msg: Value) {
        match self.backend.get() {
            Some(b) => b.queue(msg),
            None => ertepano_core::log::log("bağlantı katmanı hazır değil — mesaj düştü"),
        }
    }

    pub fn persist_if_dirty(&self) {
        let text = {
            let mut g = lock(&self.inner);
            if !g.dirty {
                return;
            }
            g.dirty = false;
            g.cache.items = g.items.iter().map(|i| i.signed.clone()).collect();
            let t = serde_json::to_string(&g.cache).ok();
            g.cache.items.clear();
            t
        };
        if let Some(t) = text {
            let tmp = cache_path().with_extension("json.tmp");
            if std::fs::write(&tmp, t).is_ok() {
                let _ = std::fs::rename(&tmp, cache_path());
            }
        }
    }
}
