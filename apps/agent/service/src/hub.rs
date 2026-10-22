//! Hizmetin merkezi durumu: sunucudan gelen doğrulanmış duyurular + bağlantı durumu.
//! Değişiklikler `watch` kanalıyla bağlı tüm arayüzlere (boru istemcileri) duyurulur.
use ertepano_core::client::{Client, Host, Status};
use ertepano_core::model::SignedItem;
use ertepano_core::{lock, VERSION};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;

struct Entry {
    id: String,
    signed: SignedItem,
}

pub struct Hub {
    dir: PathBuf,
    status: Mutex<Status>,
    items: Mutex<Vec<Entry>>,
    pub client: OnceLock<Arc<Client>>,
    sys: Mutex<sysinfo::System>,
    /// Her değişiklikte artan sürüm — boru bağlantıları buna abone
    tx: watch::Sender<u64>,
}

impl Hub {
    pub fn new(dir: PathBuf) -> Arc<Hub> {
        let (tx, _) = watch::channel(0);
        Arc::new(Hub {
            dir,
            status: Mutex::new(Status::Starting),
            items: Mutex::new(vec![]),
            client: OnceLock::new(),
            sys: Mutex::new(ertepano_core::telemetry::new_system()),
            tx,
        })
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.tx.subscribe()
    }

    fn bump(&self) {
        self.tx.send_modify(|v| *v = v.wrapping_add(1));
    }

    pub fn set_status_direct(&self, st: Status) {
        *lock(&self.status) = st;
        self.bump();
    }

    fn key(&self) -> Option<String> {
        self.client.get().and_then(|c| c.key())
    }

    fn verify(&self, s: &SignedItem) -> Option<String> {
        let key = self.key()?;
        match ertepano_core::verify::verify(&key, s) {
            Ok(a) => Some(a.id),
            Err(e) => {
                ertepano_core::log::log(&format!("duyuru reddedildi: {e}"));
                None
            }
        }
    }

    fn cache_path(&self) -> PathBuf {
        self.dir.join("cache.json")
    }

    fn persist(&self) {
        let list: Vec<SignedItem> = lock(&self.items).iter().map(|e| e.signed.clone()).collect();
        if let Ok(t) = serde_json::to_string(&list) {
            let tmp = self.cache_path().with_extension("json.tmp");
            if std::fs::write(&tmp, t).is_ok() {
                let _ = std::fs::rename(&tmp, self.cache_path());
            }
        }
    }

    /// Yeniden başlatmadan sonra çevrimdışıyken de gösterilebilsin diye önbellekteki duyurular (yeniden doğrulanır).
    pub fn restore(&self) {
        let list: Vec<SignedItem> = std::fs::read_to_string(self.cache_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let entries: Vec<Entry> = list.into_iter().filter_map(|s| self.verify(&s).map(|id| Entry { id, signed: s })).collect();
        if !entries.is_empty() {
            ertepano_core::log::log(&format!("önbellekten {} duyuru", entries.len()));
        }
        *lock(&self.items) = entries;
        self.bump();
    }

    pub fn state_json(&self) -> Value {
        let st = *lock(&self.status);
        let c = self.client.get();
        json!({
            "t": "state",
            "status": st.code(),
            "text": st.text(),
            "deviceId": c.and_then(|c| c.device_id()),
            "serverUrl": c.map(|c| c.cfg.server_url.clone()),
            "configSource": c.map(|c| c.cfg.source.clone()),
            "pending": c.map(|c| c.pending()).unwrap_or(0),
            "version": VERSION,
        })
    }

    pub fn sync_json(&self) -> Value {
        let items: Vec<SignedItem> = lock(&self.items).iter().map(|e| e.signed.clone()).collect();
        json!({ "t": "sync", "items": items })
    }

    /// Arayüzden gelen ajan → sunucu mesajı: yalnızca bilinen türler sunucuya iletilir.
    pub fn forward(&self, msg: &Value) -> bool {
        let t = msg.get("t").and_then(|t| t.as_str()).unwrap_or("");
        if !matches!(t, "ack" | "safety" | "report") {
            return false;
        }
        let Some(c) = self.client.get() else { return false };
        c.queue(msg.to_string());
        self.bump(); // "bekleyen mesaj" sayısı değişti
        true
    }
}

impl Host for Hub {
    fn set_status(&self, st: Status) {
        self.set_status_direct(st);
    }

    fn sync(&self, items: Vec<SignedItem>) {
        let entries: Vec<Entry> = items.into_iter().filter_map(|s| self.verify(&s).map(|id| Entry { id, signed: s })).collect();
        *lock(&self.items) = entries;
        self.persist();
        self.bump();
    }

    fn show(&self, item: SignedItem) {
        let Some(id) = self.verify(&item) else { return };
        {
            let mut items = lock(&self.items);
            match items.iter_mut().find(|e| e.id == id) {
                Some(e) => e.signed = item,
                None => items.push(Entry { id, signed: item }),
            }
        }
        self.persist();
        self.bump();
    }

    fn revoke(&self, id: &str) {
        lock(&self.items).retain(|e| e.id != id);
        self.persist();
        self.bump();
    }

    fn telemetry(&self) -> Value {
        let mut sys = lock(&self.sys);
        ertepano_core::telemetry::collect(&mut sys)
    }
}
