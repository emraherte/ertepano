//! Tepsi simgesi ve menüsü: çalışana da değer üreten kısayollar.
use crate::agent::agent;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

const TRAY_ID: &str = "main";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Durum: Başlatılıyor…", false, None::<&str>)?;
    let list = MenuItem::with_id(app, "list", "Duyurularım", true, None::<&str>)?;
    let it = MenuItem::with_id(app, "report-it", "IT'ye bildir…", true, None::<&str>)?;
    let nm = MenuItem::with_id(app, "report-nm", "Ramak kala bildir…", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "Bu yazılım ne topluyor?", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &list,
            &it,
            &nm,
            &PredefinedMenuItem::separator(app)?,
            &about,
            &quit,
        ],
    )?;
    let _ = agent(app).status_item.set(status);

    let mut b = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ErtePano")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "quit" => app.exit(0),
            id @ ("list" | "report-it" | "report-nm" | "about") => crate::display::open_aux(app, id),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}

pub fn set_status(app: &AppHandle, text: &str) {
    if let Some(item) = agent(app).status_item.get() {
        let _ = item.set_text(format!("Durum: {text}"));
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("ErtePano — {text}")));
    }
}
