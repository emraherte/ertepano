//! Ajan çekirdeği: yapılandırma, cihaz kimliği, doğrulanmış duyurular, yerel önbellek ve giden kutusu.
use crate::config::{self, Config, DeviceFile};
use crate::model::{Announcement, Item, SignedItem};
use crate::win::PhysRect;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Instant;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const SEEN_MAX: usize = 500;
const OUTBOX_MAX: usize = 1000;
const RECENT_MAX: usize = 30;

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn agent(app: &AppHandle) -> Arc<Agent> {
    app.state::<Arc<Agent>>().inner().clone()
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Starting,
    NoConfig,
    BadKey,
    Enrolling,
    Connecting,
    Pending,
    Online,
    Offline,
}

impl Status {
    pub fn code(self) -> &'static str {
        match self {
            Status::Starting => "starting",
            Status::NoConfig => "no_config",
            Status::BadKey => "bad_key",
            Status::Enrolling => "enrolling",
            Status::Connecting => "connecting",
            Status::Pending => "pending",
            Status::Online => "online",
            Status::Offline => "offline",
        }
    }
    pub fn text(self) -> &'static str {
        match self {
            Status::Starting => "Başlatılıyor…",
            Status::NoConfig => "Yapılandırma bulunamadı (agent.json)",
            Status::BadKey => "Kayıt anahtarı geçersiz",
            Status::Enrolling => "Kayıt olunuyor…",
            Status::Connecting => "Bağlanıyor…",
            Status::Pending => "Bağlı — IT onayı bekleniyor",
            Status::Online => "Bağlı",
            Status::Offline => "Bağlantı yok (yeniden denenecek)",
        }
    }
}

/// %APPDATA%\ErtePano\cache.json — çevrimdışıyken de gösterim ve kuyruktaki mesajlar için.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Cache {
    /// Aktif duyuruların imzalı hâli (açılışta yeniden doğrulanır)
    pub items: Vec<SignedItem>,
    /// Kullanıcının işlem yaptığı id'ler (okudu / onayladı / kapattı / yanıtladı) — tekrar gösterilmez
    pub handled: Vec<String>,
    /// "seen" bildirimi gönderilmiş id'ler
    pub seen: Vec<String>,
    /// Bağlantı yokken biriken ajan → sunucu mesajları (JSON metni)
    pub outbox: Vec<String>,
    /// "Duyurularım" listesi
    pub recent: Vec<Announcement>,
    /// Acil durum yoklama yanıtları: emergencyId → safe | help
    pub safety: HashMap<String, String>,
}

pub struct Inner {
    pub device: Option<DeviceFile>,
    /// TOFU ile sabitlenmiş genel anahtar (agent.json'da yoksa)
    pub tofu_key: Option<String>,
    pub status: Status,
    pub items: Vec<Item>,
    pub cache: Cache,
    pub dirty: bool,
    // gösterim durumu (display.rs)
    pub views: HashMap<String, Value>,
    pub open: HashMap<String, (isize, PhysRect)>,
    pub toast_current: Option<String>,
    pub toast_since: Option<Instant>,
    pub toast_h: f64,
    pub badge_hover: bool,
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

    /// true = ilk kez görüldü (çağıran "seen" bildirimi kuyruğa koyar)
    pub fn mark_seen(&mut self, id: &str) -> bool {
        if self.cache.seen.iter().any(|s| s == id) {
            return false;
        }
        self.cache.seen.push(id.to_string());
        cap(&mut self.cache.seen, SEEN_MAX);
        self.dirty = true;
        true
    }

    pub fn queue(&mut self, msg: Value) {
        self.cache.outbox.push(msg.to_string());
        cap(&mut self.cache.outbox, OUTBOX_MAX);
        self.dirty = true;
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
    pub inner: Mutex<Inner>,
    /// Giden kutusuna yeni mesaj geldi → WebSocket döngüsü uyanır
    pub notify: tokio::sync::Notify,
    pub status_item: OnceLock<MenuItem<Wry>>,
    pub sys: Mutex<sysinfo::System>,
}

fn cache_path() -> std::path::PathBuf {
    config::data_dir().join("cache.json")
}

impl Agent {
    pub fn load() -> Agent {
        let cfg = config::load();
        let mut device = config::load_device();
        let tofu_key = device.as_ref().map(|d| d.public_key.clone()).filter(|k| !k.is_empty());
        if device.as_ref().is_some_and(|d| d.device_id.is_empty() || d.device_secret.is_empty()) {
            device = None;
        }
        if let (Some(c), Some(d)) = (&cfg, &device) {
            if !d.server_url.is_empty() && d.server_url != c.server_url {
                crate::log::log("sunucu adresi değişmiş — yeniden kayıt olunacak");
                device = None;
            }
        }
        let cache: Cache = std::fs::read_to_string(cache_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();

        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        sys.refresh_memory();

        let mut inner = Inner {
            device,
            tofu_key,
            status: if cfg.is_some() { Status::Starting } else { Status::NoConfig },
            items: vec![],
            cache,
            dirty: false,
            views: HashMap::new(),
            open: HashMap::new(),
            toast_current: None,
            toast_since: None,
            toast_h: 220.0,
            badge_hover: false,
        };
        let ag_key = key_for(&cfg, &inner);
        // önbellekteki duyuruları yeniden doğrula (süresi dolan / eski acil yükler düşer)
        let cached = std::mem::take(&mut inner.cache.items);
        if let Some(key) = ag_key {
            for s in cached {
                if let Ok(a) = crate::verify::verify(&key, &s) {
                    inner.items.push(Item { signed: s, a });
                }
            }
        }
        Agent {
            cfg,
            inner: Mutex::new(inner),
            notify: tokio::sync::Notify::new(),
            status_item: OnceLock::new(),
            sys: Mutex::new(sys),
        }
    }

    pub fn key(&self, g: &Inner) -> Option<String> {
        key_for(&self.cfg, g)
    }

    fn check(&self, g: &Inner, s: &SignedItem) -> Option<Announcement> {
        let Some(key) = self.key(g) else {
            crate::log::log("genel anahtar yok — duyuru gösterilmeyecek");
            return None;
        };
        match crate::verify::verify(&key, s) {
            Ok(a) => Some(a),
            Err(e) => {
                crate::log::log(&format!("duyuru reddedildi: {e}"));
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

fn key_for(cfg: &Option<Config>, g: &Inner) -> Option<String> {
    cfg.as_ref()
        .map(|c| c.public_key.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| g.tofu_key.clone())
}
