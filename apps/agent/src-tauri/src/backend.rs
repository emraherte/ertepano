//! Bağlantı katmanı.
//! - Service: Windows hizmeti (ertepano-service) sunucuyla konuşur; bu süreç yerel borudan (\\.\pipe\ErtePano.Agent)
//!   duyuruları alır, kullanıcının işlemlerini geri yollar. Kurumsal kurulumun normal hâli.
//! - Direct: hizmet yoksa (geliştirme) bu süreç sunucuya kendisi bağlanır.
//! Her iki modda da duyuru imzaları bu süreçte yeniden doğrulanır; boruyu taklit eden bir süreç sahte duyuru gösteremez.
use crate::agent::{agent, lock, Agent};
use ertepano_core::client::{Client, Host, Status};
use ertepano_core::model::SignedItem;
use ertepano_core::PIPE_NAME;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub enum Backend {
    Direct(Arc<Client>),
    Service(Arc<PipeLink>),
}

impl Backend {
    pub fn queue(&self, msg: Value) {
        match self {
            Backend::Direct(c) => c.queue(msg.to_string()),
            Backend::Service(p) => p.queue(json!({ "t": "out", "msg": msg }).to_string()),
        }
    }

    pub fn pending(&self) -> usize {
        match self {
            Backend::Direct(c) => c.pending(),
            Backend::Service(p) => lock(&p.out).len(),
        }
    }

    pub fn mode(&self) -> &'static str {
        match self {
            Backend::Direct(_) => "direct",
            Backend::Service(_) => "service",
        }
    }
}

/// Hizmetin borusu açık mı? (Bağlanıp hemen bırakır; hizmet bunu boş bir bağlantı olarak görür.)
pub fn service_available() -> bool {
    match std::fs::OpenOptions::new().read(true).write(true).open(PIPE_NAME) {
        Ok(_) => true,
        // ERROR_PIPE_BUSY: boru var ama tüm örnekler meşgul
        Err(e) => e.raw_os_error() == Some(231),
    }
}

pub fn set_status(app: &AppHandle, st: Status) {
    let ag = agent(app);
    {
        let mut g = lock(&ag.inner);
        if g.status == st {
            return;
        }
        g.status = st;
    }
    ertepano_core::log::log(&format!("durum: {}", st.text()));
    crate::tray::set_status(app, st.text());
    let _ = app.emit("status", json!({ "code": st.code(), "text": st.text() }));
}

// ---- Direct: core istemcisinin olaylarını doğrudan ekrana bağla ----------------------------

pub struct UiHost(pub AppHandle);

impl Host for UiHost {
    fn set_status(&self, st: Status) {
        set_status(&self.0, st);
    }
    fn sync(&self, items: Vec<SignedItem>) {
        agent(&self.0).apply_sync(items);
        let _ = self.0.emit("items", ());
    }
    fn show(&self, item: SignedItem) {
        agent(&self.0).upsert(item);
        let _ = self.0.emit("items", ());
    }
    fn revoke(&self, id: &str) {
        agent(&self.0).revoke(id);
        let _ = self.0.emit("items", ());
    }
    fn telemetry(&self) -> Value {
        let ag = agent(&self.0);
        let mut sys = lock(&ag.sys);
        ertepano_core::telemetry::collect(&mut sys)
    }
}

// ---- Service: yerel boru istemcisi -----------------------------------------------------------

pub struct PipeLink {
    /// Hizmete gidecek satırlar (bağlantı yokken birikir)
    out: Mutex<VecDeque<String>>,
    notify: tokio::sync::Notify,
}

impl PipeLink {
    pub fn new() -> Arc<PipeLink> {
        Arc::new(PipeLink { out: Mutex::new(VecDeque::new()), notify: tokio::sync::Notify::new() })
    }

    fn queue(&self, line: String) {
        {
            let mut q = lock(&self.out);
            q.push_back(line);
            while q.len() > 1000 {
                q.pop_front();
            }
        }
        self.notify.notify_one();
    }

    pub async fn run(self: Arc<Self>, app: AppHandle) {
        loop {
            match self.session(&app).await {
                Ok(()) => ertepano_core::log::log("hizmet bağlantısı kapandı"),
                Err(e) => ertepano_core::log::log(&format!("hizmet: {e}")),
            }
            set_status(&app, Status::NoService);
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    #[cfg(windows)]
    async fn session(&self, app: &AppHandle) -> std::io::Result<()> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::windows::named_pipe::ClientOptions;

        let pipe = loop {
            match ClientOptions::new().open(PIPE_NAME) {
                Ok(p) => break p,
                Err(e) if e.raw_os_error() == Some(231) => tokio::time::sleep(Duration::from_millis(200)).await,
                Err(e) => return Err(e),
            }
        };
        ertepano_core::log::log("hizmete bağlanıldı");
        let (rd, mut wr) = tokio::io::split(pipe);
        let mut lines = BufReader::new(rd).lines();
        loop {
            // birikenleri gönder
            loop {
                let next = lock(&self.out).front().cloned();
                let Some(l) = next else { break };
                wr.write_all(format!("{l}\n").as_bytes()).await?;
                lock(&self.out).pop_front();
            }
            tokio::select! {
                line = lines.next_line() => {
                    let Some(line) = line? else { return Ok(()) };
                    on_message(app, &line);
                }
                _ = self.notify.notified() => {}
            }
        }
    }

    #[cfg(not(windows))]
    async fn session(&self, _app: &AppHandle) -> std::io::Result<()> {
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "yalnızca Windows"))
    }
}

fn on_message(app: &AppHandle, line: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    let ag: Arc<Agent> = agent(app);
    match v.get("t").and_then(|t| t.as_str()).unwrap_or("") {
        "state" => {
            let key = v.get("publicKey").and_then(|k| k.as_str()).filter(|k| !k.is_empty()).map(String::from);
            {
                let mut g = lock(&ag.inner);
                g.service_key = key;
                g.service_info = v.clone();
            }
            let st = Status::from_code(v.get("status").and_then(|s| s.as_str()).unwrap_or(""));
            set_status(app, st);
            let _ = app.emit("status", json!({ "code": st.code(), "text": st.text() }));
        }
        "sync" => {
            let items: Vec<SignedItem> = v.get("items").cloned().and_then(|i| serde_json::from_value(i).ok()).unwrap_or_default();
            ag.apply_sync(items);
            let _ = app.emit("items", ());
        }
        _ => {}
    }
}
