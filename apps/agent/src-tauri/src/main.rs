//! ErtePano Ajan — kurumsal ekran duyuruları (İK · İSG · IT) ve KVKK uyumlu IT envanteri.
//! Sözleşme: docs/PROTOKOL.md
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod commands;
mod config;
mod display;
mod log;
mod model;
mod net;
mod telemetry;
mod tray;
mod verify;
mod win;

use std::sync::Arc;
use tauri::{RunEvent, WindowEvent};

fn main() {
    let ag = Arc::new(agent::Agent::load());
    crate::log::log(&format!("ErtePano Ajan {} başladı", agent::VERSION));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // ikinci kez çalıştırılırsa: mevcut ajan "Duyurularım"ı açar
            display::open_aux(app, "list");
        }))
        .manage(ag)
        .invoke_handler(tauri::generate_handler![
            commands::get_view,
            commands::act,
            commands::safety,
            commands::send_report,
            commands::recent,
            commands::status,
            commands::fit_height,
            commands::close_window,
        ])
        .on_window_event(|w, e| {
            // acil durum ekranı Alt+F4 ile kapatılamaz (yalnızca yanıt veya sunucu "revoke" kaldırır)
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label().starts_with("fs-") {
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            let st = agent::agent(&handle).inner.lock().map(|g| g.status).unwrap_or(agent::Status::Starting);
            tray::set_status(&handle, st.text());
            tauri::async_runtime::spawn(net::run(handle.clone()));
            std::thread::spawn(move || display::run_loop(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ErtePano Ajan başlatılamadı")
        .run(|_app, e| {
            // pencere kalmasa da tepside çalışmaya devam et; yalnızca "Çıkış" kapatır
            if let RunEvent::ExitRequested { api, code, .. } = e {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
