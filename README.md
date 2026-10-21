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
| `apps/panel` | React + Vite + Tailwind CSS v4 + Framer Motion + Lucide web paneli (açık/koyu tema, ⌘K komut paleti) + `/kiosk` TV ekranı |
| `apps/agent` | Windows ajanı: **Windows hizmeti** (`ertepano-service`, LocalSystem) + kullanıcı oturumu arayüzü (Tauri v2), imzalı **MSI** ([README](apps/agent/README.md)) |
| `deploy/gpo` | GPO dağıtımı: yönetim şablonu (ADMX/ADML), rehber, istemci denetim ve GPO taklit betikleri ([README](deploy/gpo/README.md)) |
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

Depo kökünde `.env` dosyası varsa otomatik okunur (örnek: [.env.example](.env.example)).

| Değişken | Varsayılan | |
|---|---|---|
| `PORT` | 4100 | |
| `DATA_DIR` | `./data` | Veritabanı, imza anahtarı, yüklenen görseller — **yedekleyin** |
| `PUBLIC_URL` | istek adresi | Ajanlara verilen görsel adresleri ve agent.json için |
| `SECURE_COOKIES` | false | HTTPS arkasında true |
| `TZ_NAME` | Europe/Istanbul | Özel gün/kutlama günü hesabı |
| `RETENTION_TELEMETRY_DAYS` / `RETENTION_DELIVERY_DAYS` / `RETENTION_COMPLIANCE_DAYS` | 30 / 365 / 730 | KVKK saklama süreleri |
| `ADMIN_PASSWORD` | rastgele | İlk yönetici parolası (yalnız ilk açılışta; konsola yazılmaz, `data/ILK-YONETICI-PAROLASI.txt` ilk parola değişiminde silinir) |
| `TRUST_PROXY` | boş | Önünde reverse proxy varsa onun IP/CIDR'ı. Boşken `X-Forwarded-For`'a güvenilmez |
| `ALLOWED_ORIGINS` | boş | Panelin açıldığı ek kökenler (CSRF köken denetimi; `PUBLIC_URL` kökeni zaten izinli) |
| `DATA_DIR_ACL` | açık | Windows'ta veri klasörünü SYSTEM + Yöneticiler + sunucu hesabına kısıtlar; `off` ile kapatılır |

## Active Directory (LDAP) girişi

`.env` içinde `LDAP_URL` ve `LDAP_BASE_DN` verildiğinde açılır. Çalışanlar Windows kullanıcı adıyla (`ad.soyad`, `SIRKET\ad.soyad` veya
`ad.soyad@sirket.local`) girer; panel hesabı ilk girişte otomatik oluşur ve **rolü her girişte AD grubundan** yeniden hesaplanır
(`LDAP_GROUP_ADMIN / IT / ISG / IK / VIEWER`; birden fazla gruptaysa en yetkili rol). Grup DN'i verilirse iç içe gruplar da çözülür.

- Servis hesabıyla arama → kullanıcının kendi parolasıyla bağlanma; boş parola ve devre dışı AD hesabı reddedilir, filtre girdisi kaçışlanır.
- **Yerel hesaplar her zaman çalışır** (ör. `admin`): AD'ye ulaşılamazsa yönetici yine girebilir.
- Panel → **Sistem & LDAP**: yapılandırma özeti, bağlantı testi, rol gruplarının varlığı ve bir kullanıcının hangi rolle gireceği.
- AD kullanıcısının rolü/parolası panelden değiştirilemez; yalnızca erişimi kapatılabilir.

## İki faktörlü doğrulama (2FA)

Microsoft / Google Authenticator ile TOTP (RFC 6238). Parola doğruysa 5 dakikalık bir doğrulama bileti verilir; oturum ancak
6 haneli kod (ya da tek kullanımlık kurtarma kodu) ile açılır.

- **Zorunluluk:** Sistem & güvenlik → hangi rollerde zorunlu (varsayılan: Yönetici). Zorunlu roldeki kullanıcı kurulumu bitirene kadar
  yalnızca kurulum ekranını görür. AD kullanıcıları için de geçerlidir.
- Gizli anahtarlar veritabanında AES-256-GCM ile şifreli (`data/keys/mfa.key`); kurtarma kodlarının yalnızca HMAC özeti tutulur.
- Aynı kod iki kez kullanılamaz; bilet 5 hatalı denemede düşer; kullanıcı başına 15 dk'da 10 hatalı kod sınırı.
- Telefonunu kaybeden kullanıcı: Kullanıcılar → **2FA sıfırla** (yönetici). 2FA açılınca kullanıcının diğer oturumları kapanır.

## Modüler lisans

| Paket | İçerik |
|---|---|
| **Temel** (her lisansta) | Genel duyurular, özel gün rozetleri, kiosk/TV, cihaz kaydı, kullanıcılar, 2FA, LDAP |
| **İK modülü** | İK duyuruları, anketler, doğum günü / kıdem / hoş geldin kutlamaları |
| **İSG modülü** | Tam ekran acil durum + canlı yoklama, tatbikat, ramak kala, İSG duyuruları |
| **IT modülü** | Donanım envanteri ve sağlık uyarıları, CSV, IT duyuruları, siber olay uyarısı, IT talepleri |

- Lisans yokken ilk açılıştan itibaren **30 gün tüm modüller açık deneme** (25 cihaz). Süresi dolan lisans 14 gün ek süreyle çalışır,
  sonra yalnızca temel paket kalır. Acil durum her koşulda **sonlandırılabilir**.
- Lisans dosyası satıcının Ed25519 özel anahtarıyla imzalıdır; müşteri lisans üretemez/değiştiremez. İsteğe bağlı olarak sunucu
  kimliğine bağlanır (Lisans ve modüller sayfasında görünür). Cihaz sınırı onayda uygulanır.
- **Satıcı aracı** (müşteriye verilmez):

  ```bash
  npm run license -- keygen      # bir kez; özel anahtar %USERPROFILE%\.ertepano-vendor\ altında (depoya girmez — yedekleyin)
  npm run license -- issue --customer "Örnek A.Ş." --modules ik,isg --devices 250 --until 2027-12-31 --out ornek.lic
  npm run license -- show ornek.lic
  ```

  Müşteri: Panel → **Lisans ve modüller** → dosyayı yükle. Modüller yeniden kurulum gerekmeden anında açılır.

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
scrypt parola, 2FA, `httpOnly + SameSite=Strict` oturum çerezi + Origin denetimi (CSRF), 2 saat hareketsizlikte düşen oturum,
IP ve kullanıcı başına kaba kuvvet sınırı, CSP/HSTS/Permissions-Policy başlıkları ve **hash zincirli, silinemez denetim kaydı**
(Denetim kaydı → *Bütünlüğü doğrula*) vardır. Yüklenen görsel türü dosya içeriğinden doğrulanır; duyurularda yalnızca sunucuya
yüklenmiş görseller kullanılabilir. Kayıt anahtarını bilen biri onaylı bir cihazın kimliğine bürünemez (eski cihaz sırrı
kanıtlanmazsa cihaz IT onayına düşer); ajan yalnızca kendisine gönderilen duyuruya yanıt yazabilir ve mesajları hız sınırlıdır.
Ajan ekran görüntüsü, pencere başlığı, klavye/fare, tarayıcı geçmişi veya dosya verisi **toplamaz**.

## Ajanı dağıtma

1. `apps/agent/scripts/build-msi.ps1 -CertThumbprint <kod imzalama sertifikası>` → `apps/agent/dist/ErtePano-Ajan-<sürüm>-x64.msi`
2. MSI'ı paylaşıma koyun, GPO → *Software installation (Assigned)*; `deploy/gpo/ErtePano.admx` ile sunucu adresi,
   kayıt anahtarı, imza anahtarı ve OU başına lokasyon verin. Ayrıntı: [deploy/gpo/README.md](deploy/gpo/README.md).
3. İstemcide `deploy/gpo/Test-ErtePanoClient.ps1`. Etki alanı olmadan deneme: `deploy/gpo/Simulate-GpoInstall.ps1` (yönetici).

## Testler

```bash
npm test     # 2FA, CSRF, hız sınırı, rol yetkileri/KVKK, yükleme doğrulama, cihaz ele geçirme, WebSocket, denetim zinciri, lisans (32 test)
```

## Bilinen eksikler (sıradaki adımlar)

mTLS, imzalı otomatik güncelleme, PostgreSQL seçeneği, tatbikat tutanağı PDF — bkz. şartname §7.
