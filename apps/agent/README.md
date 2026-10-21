# ErtePano Ajan (Windows)

İki süreçten oluşur; sözleşme: [`docs/PROTOKOL.md`](../../docs/PROTOKOL.md) (§6 hizmet ⇄ arayüz).

| Süreç | Hesap | Görev |
|---|---|---|
| **`ertepano-service.exe`** — Windows hizmeti `ErtePanoAgent` | LocalSystem | Kayıt, WebSocket, telemetri, kalıcı giden kutusu, Ed25519 imza doğrulama. Her etkin oturumda arayüzü başlatır, kapatılırsa ≤10 sn içinde yeniden açar (rootkit/süreç gizleme yok). Durdurulamaz: standart kullanıcının hizmet durdurma yetkisi yoktur; çökerse SCM 10 sn sonra yeniden başlatır. |
| **`ertepano_agent.exe`** — Tauri v2 arayüzü | Oturumdaki kullanıcı | Kart, şerit, rozet, acil tam ekran, tepsi menüsü. Hizmetle yerel borudan (`\\.\pipe\ErtePano.Agent`) konuşur; imzaları kendisi de doğrular. Hizmet yoksa (geliştirme) sunucuya doğrudan bağlanır. |

```
apps/agent/
├─ core/        ortak kütüphane: yapılandırma, kayıt + WebSocket istemcisi, imza doğrulama, telemetri
├─ service/     Windows hizmeti (SCM, boru sunucusu, oturum bekçisi)
├─ src-tauri/   arayüz (Rust) + ui/ (paketleyicisiz HTML/CSS/JS)
├─ installer/   ErtePano.wxs — WiX 3 MSI tanımı
└─ scripts/     build-msi.ps1, new-test-cert.ps1
```
GPO ile dağıtım: [`deploy/gpo/README.md`](../../deploy/gpo/README.md).

## Gösterim türleri

| Tür | Pencere | Davranış |
|---|---|---|
| `toast` / `survey` | Sağ altta kart | Sırayla tek tek. Onay istemeyenler 60 sn (anket 180 sn) sonra kapanır. |
| `banner` / `countdown` | Üst şerit (birincil monitör) | Geri sayım kapatılsa da son 5 dakikada yeniden açılır. |
| `badge` | Rozet (en fazla 4 aynı anda) | `position` (9 hazır konum) ya da `posX`/`posY` (%) ile **ekranın istenen yerinde**, `size` 64–480 px, `opacity` 0.2–1. Görsel (`imageUrl`) yoksa emoji. **Click-through**; imleç üstündeyken soluklaşır. Ör. 10 Kasım'da Atatürk portresi ekranın sol üstünde, 29 Ekim'de bayrak ortada. |
| `fullscreen` | Her monitörde tam ekran | Kapatılamaz (Alt+F4 dahil). `emergencyId` varsa **Güvendeyim / Yardım lazım**; `drill` ise **TATBİKAT**; `sound` ise siren. |

**Rahatsız etmeme:** Tam ekran sunum/oyun/video açıkken kart, şerit, anket ve rozet bekler. Acil durum hiçbir zaman beklemez.

## Yapılandırma

Kaynaklar (ilk bulunan temel alınır): `%ProgramData%\ErtePano\agent.json` → `HKLM\SOFTWARE\ErtePano` (MSI özellikleri) →
exe yanındaki `agent.json` → `ERTEPANO_CONFIG` (geliştirme). Ardından **GPO** `HKLM\SOFTWARE\Policies\ErtePano`
(yönetim şablonu `deploy/gpo/ErtePano.admx`) dolu alanları ezer.

```json
{ "serverUrl": "https://pano.sirket.local", "enrollKey": "EK-XXXX-XXXX-XXXX", "publicKey": "<base64>", "location": "Gebze Fabrika", "department": "Üretim" }
```
- `publicKey`: sunucunun imza anahtarı (Panel → Ajan kurulumu). **Zorunlu.** Hizmetle çalışan arayüz anahtarı yalnızca bu
  bilgisayarın yapılandırmasından alır (hizmetten asla); yoksa hiçbir duyuru göstermez, durum "Genel anahtar yapılandırılmamış" olur.
  Hizmetsiz geliştirme modunda anahtar yoksa ilk kayıtta gelen anahtar yalnızca **https** üzerinden sabitlenir (TOFU); düz http'de kayıt yapılmaz.
- `location` / `department`: ilk kayıtta cihaz etiketi önerisi (kayıt anahtarının varsayılanı yoksa).

### Güvenlik kuralları
- `agent.json` (ProgramData ya da exe yanı) yalnızca **sahibi SYSTEM ya da Yöneticiler** ise okunur; standart kullanıcının
  bıraktığı dosya günlüğe uyarı yazılarak yok sayılır. Elle kopyaladıysanız: `icacls agent.json /setowner *S-1-5-32-544`.
  GPP → Files ile dağıtılan dosyanın sahibi zaten SYSTEM'dir.
- `ERTEPANO_CONFIG` yalnız geliştirmede okunur (hizmetin `--console` modu, hizmetsiz arayüz); hizmette ve hizmetin başlattığı arayüzde yok sayılır.
- Hizmet her başlangıçta `%ProgramData%\ErtePano` ve `\service` klasörlerinin sahibini SYSTEM yapar, DACL'i sıfırlar
  (ErtePano: Kullanıcılar okur; service: yalnız SYSTEM + Yöneticiler). Kullanıcının önceden yarattığı `service` klasörü kenara alınır,
  bağlantı (junction) ise kaldırılır. MSI de klasörleri bu izinlerle yaratır.
- Boru: etkileşimli kullanıcılar yalnızca okuma + veri yazma hakkına sahiptir (yeni boru örneği açamaz). Arayüz bağlandığı
  sunucunun oturum 0'da çalışan, aynı klasördeki `ertepano-service.exe` olduğunu doğrular.
- Görseller webview'e doğrudan yüklenmez (CSP `img-src 'self' data: blob:`): arayüz yalnızca yapılandırılmış sunucunun
  `/media/` yolundan PNG/JPG/GIF/WEBP (≤ 5 MB) indirip `data:` URL olarak verir — NTLM kimlik bilgisi sızdırma riski yok.

| Dosya | İçerik |
|---|---|
| `%ProgramData%\ErtePano\service\` (yalnız SYSTEM + Yöneticiler) | `device.json` (kimlik + sır), `outbox.json`, `cache.json`, `service.log` |
| `%APPDATA%\ErtePano\` (kullanıcı) | `cache.json` (okundu/onay/yoklama yanıtları, Duyurularım), `agent.log` |

## Geliştirme

Gerekenler: Rust (stable, MSVC), Visual Studio 2022 C++ Build Tools, Node ≥ 20. WebView2 Windows 10 21H2+/11'de hazırdır.

```powershell
cd apps/agent
cargo build --workspace                       # target/debug/ertepano-service.exe + ertepano_agent.exe

# hizmeti kurmadan ön planda çalıştır (bekçi kapalı; kimlik %APPDATA%\ErtePano\service-console)
$env:ERTEPANO_CONFIG = "C:\yol\agent.json"
.\target\debug\ertepano-service.exe --console
# ikinci terminalde arayüz: boru varsa hizmet üzerinden bağlanır. Konsol modundaki hizmet SYSTEM/oturum 0'da
# çalışmadığı için sunucu doğrulamasını yalnız geliştirmede kapatın:
$env:ERTEPANO_DEV_PIPE = "1"; $env:ERTEPANO_CONFIG = "C:\yol\agent.json"
.\target\debug\ertepano_agent.exe
```
Hizmet olmadan yalnız arayüzü çalıştırırsanız sunucuya doğrudan bağlanır (eski davranış).
El ile hizmet kurulumu (MSI'sız, yönetici): `ertepano-service.exe install` / `uninstall`.

## MSI paketi

```powershell
cd apps/agent/scripts
.\new-test-cert.ps1 -Password 'Test-Parola-1'                            # yalnız test: certs\test-codesign.pfx + .cer
.\build-msi.ps1 -PfxPath ..\certs\test-codesign.pfx -PfxPassword 'Test-Parola-1'
# üretim: kurumsal kod imzalama sertifikası (sertifika deposunda)
.\build-msi.ps1 -CertThumbprint <SHA1 parmak izi>
```
Çıktı: `apps/agent/dist/ErtePano-Ajan-<sürüm>-x64.msi` + `.sha256`. Betik hizmeti ve arayüzü release derler
(arayüz `npx @tauri-apps/cli@2 build` ile; Tauri ilk seferde WiX 3.14'ü `%LOCALAPPDATA%\tauri\WixTools314`'e indirir),
iki exe'yi ve MSI'ı `signtool` ile imzalar (zaman damgası alınamazsa uyarıp damgasız imzalar; internetsiz ortamda `-NoTimestamp`).

MSI: makine geneli x64, `%ProgramFiles%\ErtePano`, hizmeti kurar ve başlatır, çökme kurtarma (10 sn), `MajorUpgrade`
(sürüm yükseltmede ayarlar ve cihaz kimliği korunur), isteğe bağlı `SERVERURL / ENROLLKEY / PUBLICKEY / LOCATION / DEPARTMENT`.

> İkonlar `scripts/make-icons.ps1` ile üretilmiş **yer tutuculardır**; marka ikonu için `npx @tauri-apps/cli@2 icon logo.png`.

## Kod haritası

| Dosya | Görev |
|---|---|
| `core/src/config.rs` | Yapılandırma kaynakları (dosya, MSI kaydı, GPO ilkesi) |
| `core/src/client.rs` | Kayıt (HTTP), WebSocket oturumu, yeniden bağlanma (1-2-5-10-30 sn + sapma), kalıcı giden kutusu |
| `core/src/verify.rs` | Ed25519 imza + tazelik (süresi dolan / 24 saatten eski acil yükü reddet) |
| `service/src/main.rs` | SCM, `--console`, `install`/`uninstall`, hata eylemleri, durunca arayüzleri kapatma |
| `service/src/pipe.rs` | Boru sunucusu (DACL, uzak istemci reddi, istemci exe doğrulaması) |
| `service/src/watchdog.rs` | Etkin oturumlarda arayüzü `CreateProcessAsUser` ile başlatma, çökme geri çekilmesi |
| `src-tauri/src/backend.rs` | Hizmet borusu istemcisi / doğrudan mod |
| `src-tauri/src/display.rs` | Hangi pencere nerede açık olmalı (rozet konumu dahil); rahatsız etmeme |
| `src-tauri/src/win.rs` | Win32: monitörler, click-through/odak çalmama, topmost, tam ekran uygulama algılama (ErtePals'tan) |
