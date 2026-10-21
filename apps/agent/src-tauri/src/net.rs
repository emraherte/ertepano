//! Kayıt (HTTP) + WebSocket oturumu (docs/PROTOKOL.md §2–3).
use crate::agent::{agent, lock, Status, VERSION};
use crate::config::{self, Config, DeviceFile};
use crate::model::SignedItem;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const BACKOFF_SECS: [u64; 5] = [1, 2, 5, 10, 30];
const TELEMETRY_EVERY: Duration = Duration::from_secs(60);
/// Bu kadar süre sunucudan hiçbir şey gelmezse bağlantı ölü sayılır.
const DEAD_AFTER: Duration = Duration::from_secs(120);

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

pub fn set_status(app: &AppHandle, st: Status) {
    let ag = agent(app);
    {
        let mut g = lock(&ag.inner);
        if g.status == st {
            return;
        }
        g.status = st;
    }
    crate::log::log(&format!("durum: {}", st.text()));
    crate::tray::set_status(app, st.text());
    let _ = app.emit("status", json!({ "code": st.code(), "text": st.text() }));
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).build().unwrap_or_default()
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

pub async fn run(app: AppHandle) {
    let ag = agent(&app);
    let Some(cfg) = ag.cfg.clone() else {
        set_status(&app, Status::NoConfig);
        crate::tray::set_status(&app, Status::NoConfig.text());
        return;
    };
    let mut attempt = 0usize;
    loop {
        let mut welcomed = false;
        let res = session(&app, &cfg, &mut welcomed).await;
        if welcomed {
            attempt = 0;
        }
        match res {
            Err(SessErr::Auth) => {
                crate::log::log("sunucu cihaz kimliğini reddetti — yeniden kayıt olunacak");
                let keep = {
                    let mut g = lock(&ag.inner);
                    g.device = None;
                    g.tofu_key.clone().unwrap_or_default()
                };
                config::clear_device(&keep);
                tokio::time::sleep(Duration::from_millis(500 + jitter_ms(1000))).await;
                continue;
            }
            Err(SessErr::BadKey) => {
                set_status(&app, Status::BadKey);
                tokio::time::sleep(Duration::from_secs(60) + Duration::from_millis(jitter_ms(5000))).await;
                continue;
            }
            Err(SessErr::Other(e)) => {
                crate::log::log(&format!("bağlantı: {e}"));
                set_status(&app, Status::Offline);
            }
            Ok(()) => set_status(&app, Status::Offline),
        }
        let secs = BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)];
        attempt += 1;
        tokio::time::sleep(Duration::from_secs(secs) + Duration::from_millis(jitter_ms(1000))).await;
    }
}

async fn ensure_device(app: &AppHandle, cfg: &Config) -> Result<DeviceFile, SessErr> {
    let ag = agent(app);
    if let Some(d) = lock(&ag.inner).device.clone() {
        return Ok(d);
    }
    set_status(app, Status::Enrolling);
    let (hostname, mac, os, user) = tokio::task::spawn_blocking(crate::telemetry::identity).await.map_err(other)?;
    let body = json!({
        "enrollKey": cfg.enroll_key,
        "hostname": hostname,
        "mac": mac,
        "os": os,
        "agentVersion": VERSION,
        "user": user,
    });
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
    let mut g = lock(&ag.inner);
    // TOFU: agent.json'da anahtar yoksa ilk görülen anahtar sabitlenir, sonradan değişirse kabul edilmez.
    let pinned_in_cfg = !cfg.public_key.trim().is_empty();
    if !pinned_in_cfg {
        match &g.tofu_key {
            None if !server_key.is_empty() => g.tofu_key = Some(server_key.clone()),
            Some(k) if !server_key.is_empty() && *k != server_key => {
                crate::log::log("UYARI: sunucunun genel anahtarı sabitlenen anahtardan farklı — duyurular reddedilecek")
            }
            _ => {}
        }
    }
    let d = DeviceFile {
        device_id: s("deviceId"),
        device_secret: s("deviceSecret"),
        public_key: g.tofu_key.clone().unwrap_or_default(),
        server_url: cfg.server_url.clone(),
    };
    if d.device_id.is_empty() || d.device_secret.is_empty() {
        return Err(SessErr::Other("kayıt yanıtı eksik".into()));
    }
    config::save_device(&d);
    g.device = Some(d.clone());
    crate::log::log(&format!("kayıt tamam: {} ({})", d.device_id, s("status")));
    Ok(d)
}

async fn telemetry_msg(app: &AppHandle) -> String {
    let ag = agent(app);
    let data = tokio::task::spawn_blocking(move || crate::telemetry::collect(&ag)).await.unwrap_or(Value::Null);
    json!({ "t": "telemetry", "data": data }).to_string()
}

async fn session(app: &AppHandle, cfg: &Config, welcomed: &mut bool) -> Result<(), SessErr> {
    let ag = agent(app);
    let dev = ensure_device(app, cfg).await?;
    set_status(app, Status::Connecting);
    let url = ws_url(&cfg.server_url);
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
        "user": crate::telemetry::user(),
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
                let next = {
                    let mut g = lock(&ag.inner);
                    if g.cache.outbox.is_empty() {
                        None
                    } else {
                        g.dirty = true;
                        Some(g.cache.outbox.remove(0))
                    }
                };
                let Some(m) = next else { break };
                if let Err(e) = tx.send(Message::text(m.clone())).await {
                    lock(&ag.inner).cache.outbox.insert(0, m);
                    return Err(other(e));
                }
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
                                set_status(app, if pending { Status::Pending } else { Status::Online });
                                let m = telemetry_msg(app).await;
                                tx.send(Message::text(m)).await.map_err(other)?;
                                tele.reset();
                            }
                            "sync" => {
                                let items: Vec<SignedItem> = v.get("items").cloned().and_then(|i| serde_json::from_value(i).ok()).unwrap_or_default();
                                ag.apply_sync(items);
                                let _ = app.emit("items", ());
                            }
                            "show" => {
                                if let Some(s) = v.get("item").cloned().and_then(|i| serde_json::from_value::<SignedItem>(i).ok()) {
                                    ag.upsert(s);
                                    let _ = app.emit("items", ());
                                }
                            }
                            "revoke" => {
                                if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                                    ag.revoke(id);
                                    let _ = app.emit("items", ());
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
                    let m = telemetry_msg(app).await;
                    tx.send(Message::text(m)).await.map_err(other)?;
                }
            }
            _ = ag.notify.notified() => {}
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
