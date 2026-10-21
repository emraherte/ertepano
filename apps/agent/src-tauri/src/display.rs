//! Gösterim motoru: aktif duyurulardan hangi pencerelerin açık olması gerektiğini hesaplar ve uygular
//! (docs/PROTOKOL.md §5). ErtePals sahne mantığı: şeffaf, kenarlıksız, odak çalmayan, gerektiğinde click-through.
use crate::agent::{agent, lock, Inner};
use crate::model::{parse_time, Announcement};
use crate::win::{self, MonitorRaw, PhysRect};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Tüm webview'ler aynı argümanları kullanmalı (WebView2 tek tarayıcı süreci paylaşır). wry varsayılanları dahil.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
--autoplay-policy=no-user-gesture-required";

const TOAST_W: f64 = 380.0;
const BANNER_H: f64 = 64.0;
const BADGE_SIZE: f64 = 140.0;
const MARGIN: f64 = 12.0;
/// Onay gerektirmeyen kart / anket bu süre sonra kendiliğinden kapanır.
const TOAST_AUTOHIDE: Duration = Duration::from_secs(60);
const SURVEY_AUTOHIDE: Duration = Duration::from_secs(180);
/// Geri sayım: kapatılsa bile son 5 dakikada tekrar açılır; hedeften 60 sn sonra kalkar.
const COUNTDOWN_REOPEN_SECS: i64 = 300;
const COUNTDOWN_LINGER_SECS: i64 = 60;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Toast,
    Banner,
    Badge,
    Alert,
}

struct Want {
    label: String,
    page: &'static str,
    rect: PhysRect,
    scale: f64,
    kind: Kind,
    view: Value,
    item_id: String,
}

pub fn run_loop(app: AppHandle) {
    let mut n: u64 = 0;
    loop {
        tick(&app, n % 8 == 0);
        n = n.wrapping_add(1);
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn tick(app: &AppHandle, reassert: bool) {
    let ag = agent(app);
    let dnd = win::fullscreen_app();
    let mons = win::monitors();
    let (wants, queued) = {
        let mut g = lock(&ag.inner);
        let wants = plan(&mut g, dnd, &mons);
        // ilk kez ekrana gelen duyurular için "seen"
        let mut new_seen = vec![];
        for w in &wants {
            if !w.item_id.is_empty() && g.mark_seen(&w.item_id) {
                new_seen.push(w.item_id.clone());
            }
        }
        let queued = !new_seen.is_empty();
        for id in new_seen {
            g.queue(json!({ "t": "ack", "id": id, "action": "seen" }));
        }
        (wants, queued)
    };
    if queued {
        ag.notify.notify_one();
    }
    apply(app, wants);
    badge_hover(app);
    if reassert {
        let hwnds: Vec<isize> = lock(&ag.inner).open.values().map(|(h, _)| *h).collect();
        for h in hwnds {
            win::assert_topmost(h);
        }
    }
    ag.persist_if_dirty();
}

fn countdown_visible(g: &Inner, a: &Announcement, now: chrono::DateTime<chrono::Utc>) -> bool {
    let Some(to) = parse_time(&a.countdown_to) else { return !g.is_handled(&a.id) };
    let remaining = to.signed_duration_since(now).num_seconds();
    if remaining < -COUNTDOWN_LINGER_SECS {
        return false;
    }
    !g.is_handled(&a.id) || (remaining <= COUNTDOWN_REOPEN_SECS && !g.is_handled(&format!("{}#late", a.id)))
}

fn plan(g: &mut Inner, dnd: bool, mons: &[MonitorRaw]) -> Vec<Want> {
    let mut wants = vec![];
    let Some(primary) = mons.iter().find(|m| m.primary).or(mons.first()).cloned() else { return wants };
    let now = chrono::Utc::now();
    let active: Vec<Announcement> = g.items.iter().filter(|i| i.a.active(now)).map(|i| i.a.clone()).collect();
    let s = primary.scale.max(0.5);
    let work = &primary.work;
    let px = |v: f64| (v * s).round() as i32;

    // 1) Acil durum: tüm monitörler — hiçbir rahatsız etme kuralı engellemez
    let mut strip: Option<(Value, String)> = None;
    if let Some(a) = active.iter().find(|a| a.kind == "fullscreen") {
        let answer = a.emergency_id.as_ref().and_then(|e| g.cache.safety.get(e).cloned());
        if answer.is_none() && !g.is_handled(&a.id) {
            for (i, m) in mons.iter().enumerate() {
                wants.push(Want {
                    label: format!("fs-{i}"),
                    page: "fullscreen.html",
                    rect: m.monitor.clone(),
                    scale: m.scale,
                    kind: Kind::Alert,
                    view: json!({ "item": a, "primary": m.primary }),
                    item_id: a.id.clone(),
                });
            }
        } else {
            // yanıt verildi → olay bitene kadar üstte kırmızı şerit
            strip = Some((json!({ "mode": "strip", "item": a, "answer": answer }), a.id.clone()));
        }
    }

    // 2) Üst şerit: acil şeridi > duyuru şeridi / geri sayım
    let banner = strip.or_else(|| {
        if dnd {
            return None;
        }
        active
            .iter()
            .filter(|a| a.kind == "banner" || a.kind == "countdown")
            .find(|a| if a.kind == "countdown" { countdown_visible(g, a, now) } else { !g.is_handled(&a.id) })
            .map(|a| (json!({ "mode": a.kind, "item": a }), a.id.clone()))
    });
    if let Some((view, id)) = banner {
        wants.push(Want {
            label: "banner".into(),
            page: "banner.html",
            rect: PhysRect { x: work.x, y: work.y, w: work.w, h: px(BANNER_H) },
            scale: s,
            kind: Kind::Banner,
            view,
            item_id: id,
        });
    }

    // 3) Kart / anket: sırayla, tek tek; tam ekran uygulama varken bekler
    if dnd {
        g.toast_since = None;
    } else {
        let is_card = |a: &&Announcement| a.kind == "toast" || a.kind == "survey";
        let current = g
            .toast_current
            .clone()
            .and_then(|id| active.iter().find(|a| a.id == id).cloned())
            .filter(|a| !g.is_handled(&a.id));
        let next = current.or_else(|| active.iter().filter(is_card).find(|a| !g.is_handled(&a.id)).cloned());
        match next {
            Some(a) => {
                if g.toast_current.as_deref() != Some(a.id.as_str()) {
                    g.toast_current = Some(a.id.clone());
                    g.toast_since = None;
                    g.toast_h = 220.0;
                }
                let since = *g.toast_since.get_or_insert_with(Instant::now);
                let limit = if a.kind == "survey" { SURVEY_AUTOHIDE } else { TOAST_AUTOHIDE };
                if !a.require_ack && since.elapsed() > limit {
                    // sessizce kapanır (sunucuya "seen" zaten gitti); sıradaki bir sonraki tikte
                    g.mark_handled(&a.id);
                    g.toast_current = None;
                    g.toast_since = None;
                } else {
                    let queued = active.iter().filter(is_card).filter(|x| x.id != a.id && !g.is_handled(&x.id)).count();
                    let (w, h, m) = (px(TOAST_W), px(g.toast_h), px(MARGIN));
                    wants.push(Want {
                        label: "toast".into(),
                        page: "toast.html",
                        rect: PhysRect { x: work.x + work.w - w - m, y: work.y + work.h - h - m, w, h },
                        scale: s,
                        kind: Kind::Toast,
                        view: json!({ "item": a, "queued": queued }),
                        item_id: a.id.clone(),
                    });
                }
            }
            None => {
                g.toast_current = None;
                g.toast_since = None;
            }
        }
    }

    // 4) Rozet: köşede, click-through; tam ekran uygulama varken gizli
    if !dnd {
        if let Some(a) = active.iter().find(|a| a.kind == "badge") {
            let (sz, m) = (px(BADGE_SIZE), px(MARGIN));
            let top = if strip_or_banner(&wants) { px(BANNER_H) } else { 0 };
            let (x, y) = match a.position.as_deref().unwrap_or("top-right") {
                "top-left" => (work.x + m, work.y + m + top),
                "bottom-left" => (work.x + m, work.y + work.h - sz - m),
                "bottom-right" => (work.x + work.w - sz - m, work.y + work.h - sz - m - toast_height(&wants)),
                _ => (work.x + work.w - sz - m, work.y + m + top),
            };
            wants.push(Want {
                label: "badge".into(),
                page: "badge.html",
                rect: PhysRect { x, y, w: sz, h: sz },
                scale: s,
                kind: Kind::Badge,
                view: json!({ "item": a }),
                item_id: a.id.clone(),
            });
        }
    }
    wants
}

fn strip_or_banner(wants: &[Want]) -> bool {
    wants.iter().any(|w| w.kind == Kind::Banner)
}

fn toast_height(wants: &[Want]) -> i32 {
    wants.iter().find(|w| w.kind == Kind::Toast).map(|w| w.rect.h).unwrap_or(0)
}

fn apply(app: &AppHandle, wants: Vec<Want>) {
    let ag = agent(app);
    let stale: Vec<String> = {
        let g = lock(&ag.inner);
        g.open.keys().filter(|l| !wants.iter().any(|w| &w.label == *l)).cloned().collect()
    };
    for label in stale {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
        let mut g = lock(&ag.inner);
        g.open.remove(&label);
        g.views.remove(&label);
    }

    for w in wants {
        let (existing, changed) = {
            let mut g = lock(&ag.inner);
            let changed = g.views.get(&w.label) != Some(&w.view);
            if changed {
                g.views.insert(w.label.clone(), w.view.clone());
            }
            (g.open.get(&w.label).cloned(), changed)
        };
        let alive = existing.is_some() && app.get_webview_window(&w.label).is_some();
        match (existing, alive) {
            (Some((hwnd, rect)), true) => {
                if rect != w.rect {
                    win::set_rect(hwnd, &w.rect);
                    lock(&ag.inner).open.insert(w.label.clone(), (hwnd, w.rect.clone()));
                }
                if changed {
                    let _ = app.emit_to(w.label.as_str(), "view", json!({ "label": w.label, "view": w.view }));
                }
            }
            _ => match create(app, &w) {
                Ok(hwnd) => {
                    lock(&ag.inner).open.insert(w.label.clone(), (hwnd, w.rect.clone()));
                }
                Err(e) => {
                    crate::log::log(&format!("{} penceresi açılamadı: {e}", w.label));
                    lock(&ag.inner).views.remove(&w.label);
                }
            },
        }
    }
}

fn hwnd_of(w: &WebviewWindow) -> Result<isize, String> {
    #[cfg(windows)]
    {
        Ok(w.hwnd().map_err(|e| e.to_string())?.0 as isize)
    }
    #[cfg(not(windows))]
    {
        let _ = w;
        Ok(0)
    }
}

fn create(app: &AppHandle, w: &Want) -> Result<isize, String> {
    let s = w.scale.max(0.5);
    let mut b = WebviewWindowBuilder::new(app, &w.label, WebviewUrl::App(w.page.into()))
        .title("ErtePano")
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .visible(true)
        .disable_drag_drop_handler()
        .additional_browser_args(BROWSER_ARGS)
        .position(w.rect.x as f64 / s, w.rect.y as f64 / s)
        .inner_size(w.rect.w as f64 / s, w.rect.h as f64 / s);
    b = if w.kind == Kind::Alert {
        b.focused(true).background_color(Color(127, 29, 29, 255))
    } else {
        b.transparent(true).background_color(Color(0, 0, 0, 0)).focused(false).focusable(false)
    };
    let window = b.build().map_err(|e| e.to_string())?;
    let hwnd = hwnd_of(&window)?;
    // tam fiziksel yerleşim (iki kez: ilk taşıma monitör DPI değişimini tetikleyebilir)
    win::set_rect(hwnd, &w.rect);
    win::set_rect(hwnd, &w.rect);
    match w.kind {
        Kind::Badge => {
            win::ensure_overlay_style(hwnd, true);
        }
        Kind::Toast | Kind::Banner => {
            win::ensure_overlay_style(hwnd, false);
        }
        Kind::Alert => {
            let _ = window.set_focus();
        }
    }
    win::assert_topmost(hwnd);
    crate::log::log(&format!("{} açıldı ({:?})", w.label, w.rect));
    Ok(hwnd)
}

/// Rozet click-through olduğundan fare olayı almaz: imleç üzerindeyse sayfaya "hover" bildirilir (soluklaşır).
fn badge_hover(app: &AppHandle) {
    let ag = agent(app);
    let changed = {
        let mut g = lock(&ag.inner);
        let Some((_, rect)) = g.open.get("badge").cloned() else {
            g.badge_hover = false;
            return;
        };
        let over = win::cursor_pos().is_some_and(|(x, y)| rect.contains(x, y));
        if over != g.badge_hover {
            g.badge_hover = over;
            Some(over)
        } else {
            None
        }
    };
    if let Some(over) = changed {
        let _ = app.emit_to("badge", "hover", json!({ "label": "badge", "hover": over }));
    }
}

/// Tepsi menüsünden açılan normal pencereler (Duyurularım, bildirim formları, aydınlatma).
pub fn open_aux(app: &AppHandle, which: &str) {
    let app = app.clone();
    let which = which.to_string();
    // pencere oluşturma ana iş parçacığında kilitlenmesin diye ayrı iş parçacığında
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window(&which) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let (page, title, w, h) = match which.as_str() {
            "list" => ("list.html", "Duyurularım — ErtePano", 480.0, 640.0),
            "report-it" => ("report.html", "IT'ye bildir — ErtePano", 460.0, 520.0),
            "report-nm" => ("report.html", "Ramak kala bildir — ErtePano", 460.0, 580.0),
            "about" => ("about.html", "Bu yazılım ne topluyor? — ErtePano", 540.0, 680.0),
            _ => return,
        };
        let res = WebviewWindowBuilder::new(&app, &which, WebviewUrl::App(page.into()))
            .title(title)
            .inner_size(w, h)
            .min_inner_size(380.0, 400.0)
            .center()
            .resizable(true)
            .focused(true)
            .additional_browser_args(BROWSER_ARGS)
            .build();
        if let Err(e) = res {
            crate::log::log(&format!("{which} açılamadı: {e}"));
        }
    });
}
