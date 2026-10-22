# Ajan ⇄ Sunucu Protokolü (v1)

Tüm JSON alanları camelCase. Zamanlar ISO-8601 (UTC).

## 1. Ajan yapılandırması — `agent.json`

Kaynaklar (ilk bulunan temel alınır): `%ProgramData%\ErtePano\agent.json` (GPP → Files) → `HKLM\SOFTWARE\ErtePano` (MSI: `msiexec … SERVERURL=… ENROLLKEY=… PUBLICKEY=…`) → ajan exe'sinin yanındaki `agent.json` → geliştirme için `ERTEPANO_CONFIG`.
Ardından `HKLM\SOFTWARE\Policies\ErtePano` (GPO yönetim şablonu `deploy/gpo/ErtePano.admx`; değerler `ServerUrl`, `EnrollKey`, `PublicKey`, `Location`, `Department`) dolu alanları ezer.

```json
{
  "serverUrl": "http://localhost:4100",
  "enrollKey": "EK-XXXX-XXXX",
  "publicKey": "<sunucunun Ed25519 genel anahtarı, base64 (32 bayt ham)>",
  "location": "Gebze Fabrika",
  "department": "Üretim"
}
```
`location` / `department` isteğe bağlıdır (kayıtta öneri; §2).

Kayıt sonrası kimlik `device.json` dosyasına yazılır: `{ "deviceId": "...", "deviceSecret": "..." }` — Windows hizmetinde `%ProgramData%\ErtePano\service\` (yalnız SYSTEM + Yöneticiler), hizmetsiz geliştirme modunda `%APPDATA%\ErtePano\`.

`publicKey` boşsa ajan kayıt yanıtındaki anahtarı ilk kullanımda güvenir (TOFU) ve `device.json`'a yazar; sonraki tüm doğrulamalar bu anahtarla yapılır.

## 2. Kayıt

`POST /api/agent/enroll`
```json
{ "enrollKey": "EK-...", "hostname": "PC-URETIM-01", "mac": "AA:BB:...", "os": "Windows 11 Pro 23H2", "agentVersion": "0.1.0", "user": "ahmet.yilmaz" }
```
Yanıt 200:
```json
{ "deviceId": "uuid", "deviceSecret": "hex64", "status": "pending" | "approved", "publicKey": "base64" }
```
İsteğe bağlı `"location"`, `"department"` (≤ 80 karakter): kayıt anahtarının varsayılanı yoksa yeni cihaza yazılır; mevcut cihazda yalnızca alan boşsa doldurulur (IT'nin panelde verdiği etiket ezilmez).

Aynı hostname+mac tekrar kayıt olursa aynı deviceId döner, sır yenilenir. Hatalı anahtar → 403.

## 3. WebSocket — `GET /ws/agent` (üretimde wss)

İlk mesaj ajan → sunucu (5 sn içinde gelmezse bağlantı kapanır):
```json
{ "t": "hello", "deviceId": "...", "deviceSecret": "...", "agentVersion": "0.1.0", "user": "ahmet.yilmaz" }
```
Sunucu → ajan:
```json
{ "t": "welcome", "status": "approved" | "pending", "serverTime": "..." }
{ "t": "sync", "items": [SignedItem, ...] }   // cihaza yönelik tüm aktif duyurular (tam liste; listede olmayanı kaldır)
{ "t": "show", "item": SignedItem }           // yeni / güncellenmiş duyuru
{ "t": "revoke", "id": "announcementId" }     // duyuru bitti → ekrandan kaldır
{ "t": "ping" }                               // ajan {"t":"pong"} döner
```
Kimlik doğrulama hatası → `{ "t": "error", "code": "auth" }` ve kapanış. Ajan bu durumda `device.json`'ı silip yeniden kayıt olur.
`pending` durumda sunucu `sync` göndermez; telemetri kabul edilir.

Ajan → sunucu:
```json
{ "t": "telemetry", "data": Telemetry }        // bağlanınca hemen, sonra 60 sn'de bir
{ "t": "ack", "id": "announcementId", "action": "seen" | "read" | "acked" | "dismissed" | "answered", "answer": "seçenek metni (anket için)" }
{ "t": "safety", "emergencyId": "...", "status": "safe" | "help", "note": "..." }
{ "t": "report", "kind": "it_help" | "near_miss", "text": "...", "anonymous": false }
{ "t": "pong" }
```
`seen` = ekranda gösterildi; `read` = kart üzerine tıklandı/okundu; `acked` = "Okudum, anladım"; `dismissed` = kapatıldı; `answered` = anket yanıtı.

Yeniden bağlanma: 1, 2, 5, 10, 30 sn (üst sınır 30 sn) + rastgele sapma.

### Telemetry
```json
{
  "hostname": "PC-01", "ip": "10.0.1.23", "mac": "AA:BB:CC:DD:EE:FF", "user": "ahmet.yilmaz",
  "os": "Windows 11 Pro 10.0.26100", "cpuModel": "Intel i5-12400", "cpuLoad": 12.5,
  "ramTotalMb": 16384, "ramFreeMb": 7020, "diskTotalGb": 476.3, "diskFreeGb": 102.4,
  "uptimeSec": 86400, "agentVersion": "0.1.0"
}
```

## 4. İmzalı duyuru — `SignedItem`

```json
{ "payload": "<Announcement JSON metni>", "sig": "<Ed25519 imzası, base64, payload UTF-8 baytları üzerinden>" }
```
Ajan: `sig`'i doğrula → `payload`'ı parse et → `expiresAt` geçmişse veya `issuedAt` 24 saatten eskiyse **ve** `kind == "fullscreen"` ise gösterme.

### Announcement
```json
{
  "id": "uuid",
  "kind": "badge" | "toast" | "banner" | "fullscreen" | "survey" | "countdown",
  "category": "ik" | "isg" | "it" | "genel",
  "title": "Yangın tatbikatı",
  "body": "14:00'te ... (düz metin, \n satır sonu)",
  "emoji": "🔥",
  "imageUrl": "http://sunucu/media/abc.png" | null,
  "color": "#d92d20" | null,
  "requireAck": true,
  "ackLabel": "Okudum, anladım",
  "options": ["Evet", "Hayır"] | null,          // survey
  "countdownTo": "2026-10-21T15:00:00Z" | null, // countdown
  "position": "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right" | "custom" | null, // badge
  "posX": 93, "posY": 10,                     // badge: rozet MERKEZİ, birincil monitör çalışma alanının yüzdesi (0–100); sunucu hazır konumdan da hesaplar
  "size": 160 | null,                          // badge: mantıksal px (64–480), null = 160
  "opacity": 1 | null,                         // badge: 0.2–1, null = 1
  "sound": false,
  "emergencyId": "uuid" | null,                // fullscreen yoklama için
  "drill": false,                              // tatbikat → "TATBİKAT" etiketi
  "startsAt": "...", "endsAt": "..." | null,
  "issuedAt": "...", "expiresAt": "..."
}
```

## 5. Gösterim kuralları (ajan)
- `fullscreen`: tüm monitörler, always-on-top, odak alır, kapatılamaz; `emergencyId` varsa "Güvendeyim / Yardım lazım" butonları. Yanıt verildikten sonra ekran "Yanıtınız alındı" durumuna geçer ama olay `revoke` gelene kadar küçük kırmızı şerit olarak kalır.
- `toast` / `survey`: sağ alt kart. `requireAck` ise kapat yerine sadece onay butonu. Tam ekran uygulama varken bekler.
- `banner` / `countdown`: üst şerit (birincil monitör).
- `badge`: köşe, click-through.
- Aynı `id` birden fazla kez gösterilmez (onaylanan/kapatılan id'ler yerelde saklanır); `requireAck` ve onaylanmamışsa her oturum açılışında tekrar gösterilir.

## 6. Windows hizmeti ⇄ arayüz (yerel boru)

Kurumsal kurulumda ajan iki süreçtir:

| Süreç | Hesap | Görev |
|---|---|---|
| `ertepano-service.exe` (hizmet `ErtePanoAgent`) | LocalSystem | Kayıt, WebSocket, telemetri, giden kutusu, imza doğrulama; her etkin oturumda arayüzü `--managed` ile başlatır ve ayakta tutar |
| `ertepano_agent.exe` | Oturumdaki kullanıcı | Pencereler (kart, şerit, rozet, acil), tepsi menüsü; kullanıcının okundu/yanıt kayıtları `%APPDATA%\ErtePano` |

Boru `\.\pipe\ErtePano.Agent`: yalnız yerel; DACL SYSTEM + Yöneticiler + etkileşimli kullanıcılar (okuma/yazma). Hizmet, bağlanan sürecin exe'si kendi klasöründeki `ertepano_agent.exe` değilse bağlantıyı kapatır. Satır başına bir JSON.

Hizmet → arayüz (bağlanınca ve her değişiklikte):
```json
{ "t": "state", "status": "online", "text": "Bağlı", "deviceId": "…", "serverUrl": "…", "configSource": "…", "publicKey": "base64", "pending": 0, "version": "0.2.0" }
{ "t": "sync", "items": [SignedItem, …] }
```
Arayüz → hizmet:
```json
{ "t": "out", "msg": { "t": "ack" | "safety" | "report", … } }
```
Hizmet yalnızca bu üç türü sunucuya iletir. Arayüz `SignedItem` imzalarını kendisi de doğrular (anahtar: yapılandırmadaki `publicKey`, yoksa hizmetin bildirdiği); boruyu taklit eden bir süreç sahte duyuru gösteremez.
Hizmet yoksa (geliştirme) arayüz sunucuya kendisi bağlanır (§2–3).
