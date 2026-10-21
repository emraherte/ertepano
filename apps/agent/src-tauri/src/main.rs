//! ErtePano Ajan arayüzü — kullanıcı oturumunda duyuruları gösterir (İK · İSG · IT).
//! Kurumsal kurulumda Windows hizmeti (ertepano-service) bu programı her oturumda `--managed` ile başlatır.
//! Sözleşme: docs/PROTOKOL.md
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod backend;
mod commands;
mod display;
mod tray;
mod win;

use backend::{Backend, PipeLink, UiHost};
use ertepano_core::client::{Client, Status};
use ertepano_core::config;
use std::sync::Arc;
use tauri::{RunEvent, WindowEvent};

fn main() {
    ertepano_core::log::init(config::user_data().join("agent.log"));
    let managed = std::env::args().any(|a| a == "--managed");
    let ag = Arc::new(agent::Agent::load(managed));
    ertepano_core::log::log(&format!("ErtePano Ajan arayüzü {} başladı{}", agent::VERSION, if managed { " (hizmet tarafından)" } else { "" }));

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
            let ag = agent::agent(&handle);
            tray::build(&handle, !ag.managed)?;

            // Hizmet varsa (ya da hizmet bizi başlattıysa) boruyu kullan; yoksa sunucuya doğrudan bağlan.
            let use_service = ag.managed || backend::service_available();
            if use_service {
                let link = PipeLink::new();
                let _ = ag.backend.set(Backend::Service(link.clone()));
                ertepano_core::log::log("mod: Windows hizmeti üzerinden");
                tauri::async_runtime::spawn(link.run(handle.clone()));
            } else if let Some(cfg) = ag.cfg.clone() {
                let client = Client::new(cfg, config::user_data());
                let _ = ag.backend.set(Backend::Direct(client.clone()));
                ertepano_core::log::log("mod: doğrudan (hizmet yok)");
                tauri::async_runtime::spawn(client.run(Arc::new(UiHost(handle.clone()))));
            } else {
                backend::set_status(&handle, Status::NoConfig);
            }
            ag.restore_cached();
            let st = ertepano_core::lock(&ag.inner).status;
            tray::set_status(&handle, st.text());
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
