//! Sunucu istemcisi: kayıt (HTTP) + WebSocket oturumu + kalıcı giden kutusu (docs/PROTOKOL.md §2–3).
//! Gelen olayları bir `Host`a iletir: hizmet bunları boru üzerinden arayüzlere dağıtır, bağımsız arayüz doğrudan gösterir.
use crate::config::{self, Config, DeviceFile};
use crate::model::SignedItem;
use crate::{lock, VERSION};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const BACKOFF_SECS: [u64; 5] = [1, 2, 5, 10, 30];
const TELEMETRY_EVERY: Duration = Duration::from_secs(60);
/// Bu kadar süre sunucudan hiçbir şey gelmezse bağlantı ölü sayılır.
const DEAD_AFTER: Duration = Duration::from_secs(120);
const OUTBOX_MAX: usize = 1000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Starting,
    NoConfig,
    BadKey,
    Enrolling,
    Connecting,
    Pending,
    Online,
    Offline,
    /// Arayüz: Windows hizmetine ulaşılamıyor
    NoService,
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
            Status::NoService => "no_service",
        }
    }
    pub fn from_code(c: &str) -> Status {
        match c {
            "no_config" => Status::NoConfig,
            "bad_key" => Status::BadKey,
            "enrolling" => Status::Enrolling,
            "connecting" => Status::Connecting,
            "pending" => Status::Pending,
            "online" => Status::Online,
            "offline" => Status::Offline,
            "no_service" => Status::NoService,
            _ => Status::Starting,
        }
    }
    pub fn text(self) -> &'static str {
        match self {
            Status::Starting => "Başlatılıyor…",
            Status::NoConfig => "Yapılandırma bulunamadı (agent.json / GPO)",
            Status::BadKey => "Kayıt anahtarı geçersiz",
            Status::Enrolling => "Kayıt olunuyor…",
            Status::Connecting => "Bağlanıyor…",
            Status::Pending => "Bağlı — IT onayı bekleniyor",
            Status::Online => "Bağlı",
            Status::Offline => "Bağlantı yok (yeniden denenecek)",
            Status::NoService => "ErtePano hizmetine ulaşılamıyor",
        }
    }
    pub fn connected(self) -> bool {
        matches!(self, Status::Online | Status::Pending)
    }
}

/// İstemcinin olayları teslim ettiği taraf.
pub trait Host: Send + Sync + 'static {
    fn set_status(&self, st: Status);
    /// Tam liste — listede olmayan kaldırılır
    fn sync(&self, items: Vec<SignedItem>);
    fn show(&self, item: SignedItem);
    fn revoke(&self, id: &str);
    /// Telemetri verisi (engelleyici olabilir; ayrı iş parçacığında çağrılır)
    fn telemetry(&self) -> Value;
}

struct State {
    device: Option<DeviceFile>,
    tofu_key: Option<String>,
    outbox: VecDeque<String>,
    status: Status,
}

pub struct Client {
    pub cfg: Config,
    dir: PathBuf,
    st: Mutex<State>,
    notify: tokio::sync::Notify,
}

enum SessErr {
    /// Sunucu cihaz kimliğini reddetti → yeniden kayıt
    Auth,
    /// Kayıt anahtarı geçersiz (403)
    BadKey,
    Other(String),
}

fn other<E: std::fmt::Display>(e: E) -> SessErr {
    SessErr::Other(e.to_string())
}

fn jitter_ms(max: u64) -> u64 {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos() as u64).unwrap_or(0);
    n % max.max(1)
}

fn ws_url(server: &str) -> String {
    let base = if let Some(rest) = server.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = server.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{server}")
    };
    format!("{base}/ws/agent")
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap_or_default()
}

impl Client {
    /// `dir`: device.json ve outbox.json'un tutulduğu klasör.
    pub fn new(cfg: Config, dir: PathBuf) -> Arc<Client> {
        let _ = std::fs::create_dir_all(&dir);
        let mut device = config::load_device(&dir);
        let tofu_key = device.as_ref().map(|d| d.public_key.clone()).filter(|k| !k.is_empty());
        if device.as_ref().is_some_and(|d| d.device_id.is_empty() || d.device_secret.is_empty()) {
            device = None;
        }
        if device.as_ref().is_some_and(|d| !d.server_url.is_empty() && d.server_url != cfg.server_url) {
            crate::log::log("sunucu adresi değişmiş — yeniden kayıt olunacak");
            device = None;
        }
        let outbox: VecDeque<String> = std::fs::read_to_string(dir.join("outbox.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Arc::new(Client {
            cfg,
            dir,
            st: Mutex::new(State { device, tofu_key, outbox, status: Status::Starting }),
            notify: tokio::sync::Notify::new(),
        })
    }

    /// Duyuru imzalarını doğrulamak için genel anahtar (yapılandırmada sabitlenmiş ya da TOFU).
    pub fn key(&self) -> Option<String> {
        let k = self.cfg.public_key.trim();
        if !k.is_empty() {
            return Some(k.to_string());
        }
        lock(&self.st).tofu_key.clone()
    }

    pub fn status(&self) -> Status {
        lock(&self.st).status
    }

    pub fn device_id(&self) -> Option<String> {
        lock(&self.st).device.as_ref().map(|d| d.device_id.clone())
    }

    pub fn pending(&self) -> usize {
        lock(&self.st).outbox.len()
    }

    fn save_outbox(&self, st: &State) {
        if let Ok(t) = serde_json::to_string(&st.outbox) {
            let tmp = self.dir.join("outbox.json.tmp");
            if std::fs::write(&tmp, t).is_ok() {
                let _ = std::fs::rename(&tmp, self.dir.join("outbox.json"));
            }
        }
    }

    /// Ajan → sunucu mesajını kuyruğa koy (bağlantı yoksa diskte bekler).
    pub fn queue(&self, msg: String) {
        {
            let mut st = lock(&self.st);
            st.outbox.push_back(msg);
            while st.outbox.len() > OUTBOX_MAX {
                st.outbox.pop_front();
            }
            self.save_outbox(&st);
        }
        self.notify.notify_one();
    }

    fn set_status(&self, host: &dyn Host, s: Status) {
        {
            let mut st = lock(&self.st);
            if st.status == s {
                return;
            }
            st.status = s;
        }
        crate::log::log(&format!("durum: {}", s.text()));
        host.set_status(s);
    }

    pub async fn run(self: Arc<Self>, host: Arc<dyn Host>) {
        let mut attempt = 0usize;
        loop {
            let mut welcomed = false;
            let res = self.session(&host, &mut welcomed).await;
            if welcomed {
                attempt = 0;
            }
            match res {
                Err(SessErr::Auth) => {
                    crate::log::log("sunucu cihaz kimliğini reddetti — yeniden kayıt olunacak");
                    let keep = {
                        let mut st = lock(&self.st);
                        st.device = None;
                        st.tofu_key.clone().unwrap_or_default()
                    };
                    config::clear_device(&self.dir, &keep);
                    tokio::time::sleep(Duration::from_millis(500 + jitter_ms(1000))).await;
                    continue;
                }
                Err(SessErr::BadKey) => {
                    self.set_status(host.as_ref(), Status::BadKey);
                    tokio::time::sleep(Duration::from_secs(60) + Duration::from_millis(jitter_ms(5000))).await;
                    continue;
                }
                Err(SessErr::Other(e)) => {
                    crate::log::log(&format!("bağlantı: {e}"));
                    self.set_status(host.as_ref(), Status::Offline);
                }
                Ok(()) => self.set_status(host.as_ref(), Status::Offline),
            }
            let secs = BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)];
            attempt += 1;
            tokio::time::sleep(Duration::from_secs(secs) + Duration::from_millis(jitter_ms(1000))).await;
        }
    }

    async fn ensure_device(&self, host: &dyn Host) -> Result<DeviceFile, SessErr> {
        if let Some(d) = lock(&self.st).device.clone() {
            return Ok(d);
        }
        self.set_status(host, Status::Enrolling);
        let (hostname, mac, os, user) = tokio::task::spawn_blocking(crate::telemetry::identity).await.map_err(other)?;
        let cfg = &self.cfg;
        let mut body = json!({
            "enrollKey": cfg.enroll_key,
            "hostname": hostname,
            "mac": mac,
            "os": os,
            "agentVersion": VERSION,
            "user": user,
        });
        if !cfg.location.trim().is_empty() {
            body["location"] = json!(cfg.location.trim());
        }
        if !cfg.department.trim().is_empty() {
            body["department"] = json!(cfg.department.trim());
        }
        let res = http().post(format!("{}/api/agent/enroll", cfg.server_url)).json(&body).send().await.map_err(other)?;
        if res.status().as_u16() == 403 {
            return Err(SessErr::BadKey);
        }
        if !res.status().is_success() {
            return Err(SessErr::Other(format!("kayıt: HTTP {}", res.status())));
        }
        let v: Value = res.json().await.map_err(other)?;
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let server_key = s("publicKey");
        let mut st = lock(&self.st);
        // TOFU: yapılandırmada anahtar yoksa ilk görülen anahtar sabitlenir, sonradan değişirse kabul edilmez.
        if cfg.public_key.trim().is_empty() {
            match &st.tofu_key {
                None if !server_key.is_empty() => st.tofu_key = Some(server_key.clone()),
                Some(k) if !server_key.is_empty() && *k != server_key => {
                    crate::log::log("UYARI: sunucunun genel anahtarı sabitlenen anahtardan farklı — duyurular reddedilecek")
                }
                _ => {}
            }
        }
        let d = DeviceFile {
            device_id: s("deviceId"),
            device_secret: s("deviceSecret"),
            public_key: st.tofu_key.clone().unwrap_or_default(),
            server_url: cfg.server_url.clone(),
        };
        if d.device_id.is_empty() || d.device_secret.is_empty() {
            return Err(SessErr::Other("kayıt yanıtı eksik".into()));
        }
        config::save_device(&self.dir, &d);
        st.device = Some(d.clone());
        crate::log::log(&format!("kayıt tamam: {} ({})", d.device_id, s("status")));
        Ok(d)
    }

    async fn telemetry_msg(host: &Arc<dyn Host>) -> String {
        let h = host.clone();
        let data = tokio::task::spawn_blocking(move || h.telemetry()).await.unwrap_or(Value::Null);
        json!({ "t": "telemetry", "data": data }).to_string()
    }

    async fn session(self: &Arc<Self>, host_arc: &Arc<dyn Host>, welcomed: &mut bool) -> Result<(), SessErr> {
        let host: &dyn Host = host_arc.as_ref();
        let dev = self.ensure_device(host).await?;
        self.set_status(host, Status::Connecting);
        let url = ws_url(&self.cfg.server_url);
        let (ws, _) = tokio::time::timeout(Duration::from_secs(15), connect_async(url.as_str()))
            .await
            .map_err(|_| SessErr::Other("bağlantı zaman aşımı".into()))?
            .map_err(other)?;
        let (mut tx, mut rx) = ws.split();
        let hello = json!({
            "t": "hello",
            "deviceId": dev.device_id,
            "deviceSecret": dev.device_secret,
            "agentVersion": VERSION,
            "user": crate::sys::current_user(),
        });
        tx.send(Message::text(hello.to_string())).await.map_err(other)?;

        let started = Instant::now();
        let mut last_rx = Instant::now();
        let mut tele = tokio::time::interval(TELEMETRY_EVERY);
        tele.tick().await; // ilk anlık tik — telemetri "welcome" ile gönderilir

        loop {
            // giden kutusunu boşalt (yalnızca kimlik doğrulandıktan sonra)
            if *welcomed {
                loop {
                    let next = lock(&self.st).outbox.front().cloned();
                    let Some(m) = next else { break };
                    tx.send(Message::text(m)).await.map_err(other)?;
                    let mut st = lock(&self.st);
                    st.outbox.pop_front();
                    self.save_outbox(&st);
                }
            }

            tokio::select! {
                msg = rx.next() => {
                    last_rx = Instant::now();
                    match msg {
                        None => return Err(SessErr::Other("bağlantı kapandı".into())),
                        Some(Err(e)) => return Err(other(e)),
                        Some(Ok(Message::Text(t))) => {
                            let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                            match v.get("t").and_then(|x| x.as_str()).unwrap_or("") {
                                "welcome" => {
                                    *welcomed = true;
                                    let pending = v.get("status").and_then(|x| x.as_str()) == Some("pending");
                                    self.set_status(host, if pending { Status::Pending } else { Status::Online });
                                    let m = Self::telemetry_msg(host_arc).await;
                                    tx.send(Message::text(m)).await.map_err(other)?;
                                    tele.reset();
                                }
                                "sync" => {
                                    let items: Vec<SignedItem> = v.get("items").cloned().and_then(|i| serde_json::from_value(i).ok()).unwrap_or_default();
                                    host.sync(items);
                                }
                                "show" => {
                                    if let Some(s) = v.get("item").cloned().and_then(|i| serde_json::from_value::<SignedItem>(i).ok()) {
                                        host.show(s);
                                    }
                                }
                                "revoke" => {
                                    if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                                        host.revoke(id);
                                    }
                                }
                                "ping" => {
                                    tx.send(Message::text(json!({ "t": "pong" }).to_string())).await.map_err(other)?;
                                }
                                "error" => {
                                    let code = v.get("code").and_then(|x| x.as_str()).unwrap_or("");
                                    if code == "auth" {
                                        return Err(SessErr::Auth);
                                    }
                                    return Err(SessErr::Other(format!("sunucu hatası: {code}")));
                                }
                                _ => {}
                            }
                        }
                        Some(Ok(Message::Ping(p))) => {
                            let _ = tx.send(Message::Pong(p)).await;
                        }
                        Some(Ok(Message::Close(_))) => return Err(SessErr::Other("sunucu bağlantıyı kapattı".into())),
                        Some(Ok(_)) => {}
                    }
                }
                _ = tele.tick() => {
                    if *welcomed {
                        let m = Self::telemetry_msg(host_arc).await;
                        tx.send(Message::text(m)).await.map_err(other)?;
                    }
                }
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(20)) => {
                    if !*welcomed && started.elapsed() > Duration::from_secs(10) {
                        return Err(SessErr::Other("sunucu karşılama göndermedi".into()));
                    }
                    if last_rx.elapsed() > DEAD_AFTER {
                        return Err(SessErr::Other("sunucudan yanıt yok".into()));
                    }
                    // bağlantıyı canlı tut (proxy/NAT zaman aşımları)
                    tx.send(Message::Ping(Vec::new().into())).await.map_err(other)?;
                }
            }
        }
    }
}
