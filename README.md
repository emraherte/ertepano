# ErtePano — İK · İSG · IT için kurumsal ekran iletişimi

İç ağda çalışan, dışarıya veri göndermeyen platform. Merkezi web panelinden şirketteki tüm bilgisayarlara
**duyuru, anket, geri sayım, özel gün rozeti** ve **acil durum (tam ekran + canlı yoklama)** gönderir; aynı ajan
KVKK sınırları içinde **IT envanteri** toplar. ErtePals'ın şeffaf/click-through overlay motorundan türetilmiştir.

- Şartname: [docs/SARTNAME-v2.md](docs/SARTNAME-v2.md) (v1'e göre değişiklikler en üstte)
- Ajan ⇄ sunucu sözleşmesi: [docs/PROTOKOL.md](docs/PROTOKOL.md)

## Depo

| Yol | Ne |
|---|---|
| `server` | Node 20 + Fastify + SQLite (WAL). REST `/api/*`, ajan WebSocket'i `/ws/agent`, Ed25519 imza, zamanlayıcı (özel gün, kutlama, KVKK temizliği) |
| `apps/panel` | React + Vite web paneli (İK / İSG / IT / yönetici rolleri) + `/kiosk` TV ekranı |
| `apps/agent` | Windows ajanı: Tauri v2 + Rust, paketleyicisiz HTML arayüz ([README](apps/agent/README.md)) |
| `packages/shared` | Ortak tipler ve sabitler |
| `tools/sim` | Sahte ajan simülatörü (ajanı derlemeden uçtan uca deneme) |

## Hızlı başlangıç

Gerekenler: Node ≥ 20.10. Ajanı derlemek için ayrıca Rust (MSVC) + VS 2022 C++ Build Tools.

```bash
npm install
npm run seed:demo        # deneme kullanıcıları (ik, isg, it, izleyici / Demo12345!) + simülatör anahtarı
npm run dev              # sunucu :4100 + panel :5180
npm run sim -- --count 40   # (ayrı terminal) 40 sahte bilgisayar
```

Panel: http://localhost:5180 — İlk çalıştırmada `admin` parolası konsola ve `data/ILK-YONETICI-PAROLASI.txt` dosyasına yazılır.

Üretim: `npm run build && npm start` → panel ve API tek süreçte `http://sunucu:4100`. HTTPS için önüne iç CA sertifikalı
reverse proxy (IIS/nginx/Caddy) koyun ve `SECURE_COOKIES=true`, `PUBLIC_URL=https://pano.sirket.local` verin.

### Ortam değişkenleri

| Değişken | Varsayılan | |
|---|---|---|
| `PORT` | 4100 | |
| `DATA_DIR` | `./data` | Veritabanı, imza anahtarı, yüklenen görseller — **yedekleyin** |
| `PUBLIC_URL` | istek adresi | Ajanlara verilen görsel adresleri ve agent.json için |
| `SECURE_COOKIES` | false | HTTPS arkasında true |
| `TZ_NAME` | Europe/Istanbul | Özel gün/kutlama günü hesabı |
| `RETENTION_TELEMETRY_DAYS` / `RETENTION_DELIVERY_DAYS` / `RETENTION_COMPLIANCE_DAYS` | 30 / 365 / 730 | KVKK saklama süreleri |
| `ADMIN_PASSWORD` | rastgele | İlk yönetici parolası (yalnız ilk açılışta) |

## Kim ne yapar?

- **İK:** şablondan duyuru, mini anket, özel günler (Türkiye takvimi hazır), CSV ile doğum günü / kıdem / hoş geldin otomasyonu.
- **İSG:** basılı-tut onaylı acil durum yayını, **Güvendeyim / Yardım lazım** yoklaması (lokasyon bazlı canlı), tatbikat modu + tutanak,
  zorunlu okuma onayı (denetim kanıtı), ramak kala kutusu (anonim seçenekli).
- **IT:** cihaz envanteri ve uyarılar (disk %90+, 14+ gün yeniden başlatılmamış, görünmeyen cihaz), toplu onay/etiket, CSV, bakım
  geri sayımı, siber olay uyarısı, "IT'ye bildir" talepleri (cihaz özeti otomatik), ajan kayıt anahtarları ve hazır `agent.json`.
- **Herkes:** fabrika/yemekhane TV'leri için anahtarlı `/kiosk` ekranı; acil durumda kırmızıya döner.

## Güvenlik özeti

Ajan yalnızca sunucunun **Ed25519** anahtarıyla imzalanmış ve süresi dolmamış duyuruları gösterir (genel anahtar `agent.json`'da
sabitlenir). Cihazlar tek tek kayıt anahtarı + cihaz sırrı ile bağlanır, IT onayı olmadan duyuru almaz. Panelde rol bazlı yetki,
scrypt parola, `httpOnly + SameSite=Strict` oturum çerezi, kaba kuvvet sınırı ve **silinemez denetim kaydı** vardır.
Ajan ekran görüntüsü, pencere başlığı, klavye/fare, tarayıcı geçmişi veya dosya verisi **toplamaz**.

## Bilinen eksikler (sıradaki adımlar)

AD/LDAP girişi, Windows Service ayrımı, mTLS, imzalı otomatik güncelleme, PostgreSQL seçeneği, tatbikat tutanağı PDF — bkz. şartname §7.
