# ErtePano Ajan (Windows masaüstü)

Tauri v2 + Rust. Her bilgisayarda tepside çalışır; sunucudan gelen **imzalı** duyuruları ekranda gösterir,
acil durum yoklamasına yanıt alır ve KVKK uyumlu IT envanteri gönderir. Sözleşme: [`docs/PROTOKOL.md`](../../docs/PROTOKOL.md).

Ön yüz paketleyicisiz düz HTML/CSS/JS'dir (`ui/`), npm bağımlılığı yoktur.

## Gösterim türleri

| Tür | Pencere | Davranış |
|---|---|---|
| `toast` / `survey` | Sağ altta kart | Sırayla tek tek. Onay istemeyenler 60 sn (anket 180 sn) sonra kapanır. |
| `banner` / `countdown` | Üst şerit (birincil monitör) | Geri sayım kapatılsa da son 5 dakikada yeniden açılır. |
| `badge` | Köşede rozet | **Click-through** (tıklama arkadaki uygulamaya geçer); imleç üstündeyken soluklaşır. |
| `fullscreen` | Her monitörde tam ekran | Kapatılamaz (Alt+F4 dahil). `emergencyId` varsa **Güvendeyim / Yardım lazım**; `drill` ise **TATBİKAT** etiketi; `sound` ise siren. Yanıttan sonra olay bitene kadar üstte kırmızı şerit kalır. |

**Rahatsız etmeme:** Tam ekran sunum/oyun/video açıkken kart, şerit, anket ve rozet bekler. Acil durum hiçbir zaman beklemez.

## Tepsi menüsü

Durum satırı · Duyurularım · IT'ye bildir… · Ramak kala bildir… (anonim seçeneği) · Bu yazılım ne topluyor? · Çıkış

## Yapılandırma

`agent.json` şu sırayla aranır:

1. `%ProgramData%\ErtePano\agent.json` (GPO ile dağıtım için önerilen yer)
2. Ajan `.exe` dosyasının yanındaki `agent.json`
3. `ERTEPANO_CONFIG` ortam değişkenindeki yol (geliştirme)

```json
{
  "serverUrl": "http://localhost:4100",
  "enrollKey": "EK-XXXX-XXXX",
  "publicKey": "<sunucunun Ed25519 genel anahtarı, base64>"
}
```

- `enrollKey`: Panel → Ajan kurulumu → Kayıt anahtarları (sayfa hazır `agent.json`'ı da verir).
- `publicKey`: Sunucunun imza anahtarı. **Üretimde mutlaka doldurun.** Boş bırakılırsa ajan ilk kayıtta gelen anahtara güvenir (TOFU)
  ve onu `device.json`'a sabitler; sonradan değişen anahtarla imzalanmış duyurular gösterilmez.

Ajanın yazdığı dosyalar (`%APPDATA%\ErtePano\`):

| Dosya | İçerik |
|---|---|
| `device.json` | Cihaz kimliği + sırrı (+ TOFU anahtarı) |
| `cache.json` | Aktif duyurular (imzalı), okundu/kapatıldı kayıtları, gönderilmeyi bekleyen mesajlar |
| `agent.log` | Günlük (1 MB'da sıfırlanır) |

Sunucu cihaz kimliğini reddederse (`{"t":"error","code":"auth"}`) ajan kimliği silip yeniden kayıt olur.

## Derleme

Gerekenler: Rust (stable, MSVC), Visual Studio 2022 C++ Build Tools. WebView2 Windows 11'de hazırdır.

```bash
cd apps/agent/src-tauri
cargo build              # geliştirme: target/debug/ertepano_agent.exe
cargo build --release    # küçük, optimize exe: target/release/ertepano_agent.exe
```

Kurulum paketi (MSI + NSIS):

```bash
cd apps/agent/src-tauri
npx @tauri-apps/cli@2 build
# çıktı: target/release/bundle/msi/*.msi ve target/release/bundle/nsis/*.exe
```

Geliştirmede sunucuya bağlanmak için:

```powershell
$env:ERTEPANO_CONFIG = "C:\yol\agent.json"
.\target\debug\ertepano_agent.exe
```

> İkonlar `scripts/make-icons.ps1` ile üretilmiş **yer tutuculardır**. Marka ikonu hazır olunca
> `npx @tauri-apps/cli@2 icon logo.png` ile değiştirin.

## GPO ile dağıtım (notlar)

1. MSI'ı kod imzalama sertifikasıyla imzalayın (`signtool`); AV/EDR beyaz listesine ekleyin.
2. **Computer Configuration → Policies → Software Settings → Software Installation** ile MSI'ı atayın (sessiz kurulur).
3. `agent.json`'ı **Group Policy Preferences → Files** ile `%ProgramData%\ErtePano\agent.json` konumuna kopyalayın.
4. Ajan kullanıcı oturumunda çalışmalıdır (pencere gösterir): **GPP → Registry** ile
   `HKLM\Software\Microsoft\Windows\CurrentVersion\Run` altına `ErtePano = "C:\Program Files\ErtePano Ajan\ertepano_agent.exe"` ekleyin.
5. İlk açılışta ajan kayıt olur; IT panelde cihazı onaylayana kadar "IT onayı bekleniyor" durumunda kalır.

Faz 2'de telemetri + WebSocket kısmı Windows Service'e taşınacak, bu uygulama yalnızca kullanıcı oturumundaki gösterici olacaktır (bkz. şartname §3.3).

## Kod haritası

| Dosya | Görev |
|---|---|
| `src/main.rs` | Tauri kurulumu, komutlar, tek örnek, acil pencerelerinin kapatılmasını engelleme |
| `src/net.rs` | Kayıt (HTTP), WebSocket oturumu, yeniden bağlanma (1-2-5-10-30 sn + sapma), giden kutusu |
| `src/verify.rs` | Ed25519 imza doğrulama + tazelik (süresi dolan / 24 saatten eski acil yükü reddet) |
| `src/agent.rs` | Durum, önbellek (`cache.json`), okundu/kapatıldı kayıtları |
| `src/display.rs` | Hangi pencere açık olmalı → oluştur / taşı / kapat; rahatsız etmeme; rozet hover |
| `src/win.rs` | Win32: monitörler, click-through/odak çalmama stilleri, topmost, tam ekran uygulama algılama (ErtePals'tan) |
| `src/telemetry.rs` | Envanter alanları (sysinfo) |
| `src/tray.rs` | Tepsi menüsü |
| `ui/*.html, *.js` | Kart, şerit, rozet, acil ekranı, Duyurularım, bildirim formları, aydınlatma |
