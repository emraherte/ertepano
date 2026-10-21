//! ErtePano Ajan Windows hizmeti (ErtePanoAgent, LocalSystem).
//! Sunucuya bağlanır (kayıt, WebSocket, telemetri, giden kutusu), duyuruları doğrular ve yerel borudan kullanıcı
//! oturumlarındaki arayüzlere (ertepano_agent.exe) dağıtır; arayüzü her etkin oturumda başlatır ve ayakta tutar.
//!
//!   ertepano-service.exe              SCM tarafından başlatılır (MSI kurar)
//!   ertepano-service.exe --console    hizmet olmadan ön planda (test; bekçi kapalı, ERTEPANO_DATA ile veri klasörü)
//!   ertepano-service.exe install      MSI'sız el ile kurulum (yönetici)
//!   ertepano-service.exe uninstall
#![cfg_attr(not(windows), allow(dead_code))]

#[cfg(windows)]
mod hub;
#[cfg(windows)]
mod pipe;
#[cfg(windows)]
mod watchdog;
#[cfg(windows)]
mod winsys;

#[cfg(not(windows))]
fn main() {
    eprintln!("ertepano-service yalnızca Windows'ta çalışır");
}

#[cfg(windows)]
fn main() {
    imp::main();
}

#[cfg(windows)]
mod imp {
    use crate::hub::Hub;
    use ertepano_core::client::{Client, Status};
    use ertepano_core::config;
    use ertepano_core::{SERVICE_NAME, UI_EXE, VERSION};
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{watch, Notify};
    use windows_service::service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
        ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    use windows_service::{define_windows_service, service_dispatcher};

    const DISPLAY_NAME: &str = "ErtePano Ajan";
    const DESCRIPTION: &str = "ErtePano kurumsal ekran duyuruları (İK, İSG, IT) ve IT envanteri. Durdurulursa çalışanlar acil durum uyarılarını göremez.";

    pub fn main() {
        let arg = std::env::args().nth(1).unwrap_or_default();
        let code = match arg.as_str() {
            "--console" => {
                run_blocking(Mode::Console, None);
                0
            }
            "install" => report(install()),
            "uninstall" => report(uninstall()),
            "--help" | "-h" | "/?" => {
                usage();
                0
            }
            _ => match service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
                Ok(()) => 0,
                Err(_) => {
                    // SCM tarafından başlatılmadı (çift tıklama vb.)
                    usage();
                    1
                }
            },
        };
        std::process::exit(code);
    }

    fn usage() {
        println!("ErtePano Ajan hizmeti {VERSION}\n");
        println!("  ertepano-service.exe --console    ön planda çalıştır (test)");
        println!("  ertepano-service.exe install      hizmeti kur (yönetici)");
        println!("  ertepano-service.exe uninstall    hizmeti kaldır (yönetici)");
        println!("\nNormal kurulum: ErtePano-Ajan MSI paketi (GPO / msiexec).");
    }

    fn report(r: windows_service::Result<()>) -> i32 {
        match r {
            Ok(()) => {
                println!("tamam");
                0
            }
            Err(e) => {
                eprintln!("hata: {e} (yönetici olarak çalıştırın)");
                1
            }
        }
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Service,
        Console,
    }

    fn data_dir(mode: Mode) -> PathBuf {
        if let Some(d) = std::env::var_os("ERTEPANO_DATA") {
            return PathBuf::from(d);
        }
        match mode {
            Mode::Service => config::program_data().join("service"),
            // konsol testi: kurulu hizmetin kimliğine dokunma
            Mode::Console => config::user_data().join("service-console"),
        }
    }

    fn failure_actions() -> ServiceFailureActions {
        ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
            reboot_msg: None,
            command: None,
            actions: Some(vec![ServiceAction { action_type: ServiceActionType::Restart, delay: Duration::from_secs(10) }; 3]),
        }
    }

    fn install() -> windows_service::Result<()> {
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
        let exe = std::env::current_exe().map_err(windows_service::Error::Winapi)?;
        let info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe,
            launch_arguments: vec![],
            dependencies: vec![],
            account_name: None, // LocalSystem
            account_password: None,
        };
        let service = manager.create_service(&info, ServiceAccess::CHANGE_CONFIG | ServiceAccess::START)?;
        service.set_description(DESCRIPTION)?;
        service.update_failure_actions(failure_actions())?;
        service.start::<&str>(&[])?;
        Ok(())
    }

    fn uninstall() -> windows_service::Result<()> {
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
        let service = manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE)?;
        if service.query_status()?.current_state != ServiceState::Stopped {
            let _ = service.stop();
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(500));
                if service.query_status()?.current_state == ServiceState::Stopped {
                    break;
                }
            }
        }
        service.delete()
    }

    define_windows_service!(ffi_service_main, service_main);

    fn service_main(_args: Vec<OsString>) {
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
        let wake = Arc::new(Notify::new());
        let wake2 = wake.clone();
        let handler = move |control| -> ServiceControlHandlerResult {
            match control {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    let _ = stop_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::SessionChange(_) => {
                    wake2.notify_one();
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        };
        let Ok(status) = service_control_handler::register(SERVICE_NAME, handler) else { return };
        let set = |state: ServiceState, accept: ServiceControlAccept| {
            let _ = status.set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: state,
                controls_accepted: accept,
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint: Duration::from_secs(10),
                process_id: None,
            });
        };
        set(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN | ServiceControlAccept::SESSION_CHANGE);
        run_blocking(Mode::Service, Some((stop_rx, wake)));
        set(ServiceState::Stopped, ServiceControlAccept::empty());
    }

    /// Kurulumdan bağımsız olarak hata eylemlerini garanti et (MSI de ayarlar).
    fn ensure_failure_actions() {
        let Ok(manager) = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) else { return };
        if let Ok(s) = manager.open_service(SERVICE_NAME, ServiceAccess::CHANGE_CONFIG) {
            let _ = s.update_failure_actions(failure_actions());
        }
    }

    fn run_blocking(mode: Mode, scm: Option<(std::sync::mpsc::Receiver<()>, Arc<Notify>)>) {
        let dir = data_dir(mode);
        let _ = std::fs::create_dir_all(&dir);
        ertepano_core::log::init(dir.join("service.log"));
        ertepano_core::log::log(&format!(
            "ErtePano Ajan hizmeti {VERSION} başladı ({})",
            if mode == Mode::Service { "Windows hizmeti" } else { "konsol" }
        ));
        if mode == Mode::Service {
            crate::winsys::secure_dir(&dir);
            ensure_failure_actions();
        }

        let rt = match tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                ertepano_core::log::log(&format!("çalışma zamanı oluşturulamadı: {e}"));
                return;
            }
        };
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let wake = scm.as_ref().map(|(_, w)| w.clone()).unwrap_or_else(|| Arc::new(Notify::new()));

        rt.block_on(async {
            let hub = Hub::new(dir.clone());
            let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default();
            let ui_exe = exe_dir.join(UI_EXE);

            tokio::spawn(crate::pipe::serve(hub.clone(), ui_exe.clone(), shutdown_rx.clone()));
            if mode == Mode::Service {
                tokio::spawn(crate::watchdog::run(ui_exe, wake, shutdown_rx.clone()));
            } else {
                ertepano_core::log::log("konsol modu: arayüz bekçisi kapalı — arayüzü el ile başlatın");
            }

            // Yapılandırma GPO ile sonradan gelebilir: bulunana kadar dakikada bir yeniden dene.
            let h = hub.clone();
            let mut sd = shutdown_rx.clone();
            tokio::spawn(async move {
                let cfg = loop {
                    if let Some(c) = config::load() {
                        break c;
                    }
                    h.set_status_direct(Status::NoConfig);
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(60)) => {}
                        _ = sd.changed() => return,
                    }
                };
                let client = Client::new(cfg, dir);
                let _ = h.client.set(client.clone());
                h.restore();
                client.run(h).await;
            });

            match scm {
                Some((stop_rx, _)) => {
                    let _ = tokio::task::spawn_blocking(move || stop_rx.recv()).await;
                }
                None => {
                    println!("ErtePano hizmeti konsolda çalışıyor — durdurmak için Ctrl+C");
                    let _ = tokio::signal::ctrl_c().await;
                }
            }
            ertepano_core::log::log("hizmet durduruluyor");
            let _ = shutdown_tx.send(true);
        });
        rt.shutdown_timeout(Duration::from_secs(3));
        if mode == Mode::Service {
            stop_ui_processes();
        }
    }

    /// Hizmet durunca (MSI yükseltme/kaldırma dahil) başlattığı arayüzleri kapat: exe kilitli kalmasın, sessiz
    /// kurulum "dosya kullanımda" yüzünden yeniden başlatma istemesin. Hizmet yeniden başlayınca bekçi açar.
    fn stop_ui_processes() {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let name = UI_EXE.to_ascii_lowercase();
        let mut n = 0;
        for p in sys.processes().values() {
            if p.name().to_string_lossy().to_ascii_lowercase() == name && p.kill() {
                n += 1;
            }
        }
        if n > 0 {
            ertepano_core::log::log(&format!("{n} arayüz süreci kapatıldı"));
        }
    }
}
