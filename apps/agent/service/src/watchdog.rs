//! Bekçi: oturum açmış her kullanıcıda arayüzün (ertepano_agent.exe) çalışmasını sağlar.
//! Kullanıcı arayüzü Görev Yöneticisi'nden kapatsa bile en geç 10 sn içinde yeniden açılır (kapatılamazlık, rootkit'siz).
//! Arayüz sürekli çöküyorsa (5 dk'da 5 başlatma) o oturum için 5 dk beklenir.
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::sync::{watch, Notify};

const EVERY: Duration = Duration::from_secs(10);
const WINDOW: Duration = Duration::from_secs(300);
const MAX_LAUNCHES: usize = 5;

pub async fn run(ui_exe: PathBuf, wake: Arc<Notify>, mut shutdown: watch::Receiver<bool>) {
    let mut sys = System::new();
    let mut launches: HashMap<u32, VecDeque<Instant>> = HashMap::new();
    let exe_name = ertepano_core::UI_EXE.to_ascii_lowercase();
    loop {
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let running: HashSet<u32> = sys
            .processes()
            .iter()
            .filter(|(_, p)| p.name().to_string_lossy().to_ascii_lowercase() == exe_name)
            .filter_map(|(pid, _)| crate::winsys::session_of(pid.as_u32()))
            .collect();
        let sessions = crate::winsys::active_sessions();
        launches.retain(|s, _| sessions.contains(s));
        for s in sessions {
            if running.contains(&s) {
                continue;
            }
            let hist = launches.entry(s).or_default();
            while hist.front().is_some_and(|t| t.elapsed() > WINDOW) {
                hist.pop_front();
            }
            if hist.len() >= MAX_LAUNCHES {
                continue; // sürekli çöküyor — pencere dolana kadar bekle
            }
            hist.push_back(Instant::now());
            match crate::winsys::launch_in_session(s, &ui_exe) {
                Ok(pid) => ertepano_core::log::log(&format!("oturum {s}: arayüz başlatıldı (pid {pid})")),
                Err(e) => ertepano_core::log::log(&format!("oturum {s}: arayüz başlatılamadı: {e}")),
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(EVERY) => {}
            _ = wake.notified() => tokio::time::sleep(Duration::from_secs(2)).await, // oturum açılışı: kabuk hazır olsun
            _ = shutdown.changed() => return,
        }
    }
}
