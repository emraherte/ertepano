# ErtePano — Kurumsal Ekran İletişim Platformu
### Teknik Şartname v2 (v1 üzerine geliştirilmiş)

> **Ürün adı (çalışma adı):** ErtePano — "Erte" + "Pano". Kodda tek yerden değiştirilebilir.
> **Kullanıcılar:** İK · İSG (İş Sağlığı ve Güvenliği) · IT
> **İlke:** *Bir duyuru 30 saniyede yayınlanır, acil durum 3 saniyede.* Her ekran Türkçe, sade, şablonla başlar.

---

## 0. v1'e göre ne değişti? (Özet)

| # | v1 | v2 | Neden |
|---|---|---|---|
| 1 | Go + PostgreSQL + Redis + MinIO + Docker | **Node 20 + Fastify + SQLite (WAL)**, tek süreç; Postgres/Docker *opsiyonel* | ErtePals'ta zaten bilinen yığın → 2–3 kat hızlı geliştirme. 100–3.000 PC için tek Node süreci ve SQLite fazlasıyla yeter. Kurulum "Node kur + `npm start`". Redis/MinIO ihtiyaç doğana kadar yok. |
| 2 | 3 gösterim modu | **6 mod**: rozet, kart (toast), üst şerit, tam ekran acil, **anket**, **geri sayım** | İK anketleri ve IT bakım sayaçları ayrı birer UX ister. |
| 3 | İSG = sadece "acil durum ekranı" | **İSG modülü**: acil yayın + **"Güvendeyim / Yardım lazım" yoklaması**, tatbikat modu, zorunlu okuma + mini sınav | Acil durumda asıl soru "Kim güvende?" Yoklama, toplanma alanında kâğıt listeyi ortadan kaldırır. |
| 4 | Ajan tek yönlü (sunucu → ekran) | Ajan **iki yönlü**: tepsi menüsünden **"IT'ye bildir"** (cihaz bilgisi otomatik eklenir) | Çalışan için de değer üretir; ajan "izleyen yazılım" değil "yardım eden yazılım" olarak algılanır. |
| 5 | Mavi yaka ekranı yok | **Kiosk / TV modu**: fabrika, yemekhane, girişteki TV'lere tarayıcıdan tam ekran pano | Bilgisayarı olmayan çalışan da İSG ve İK duyurusunu görür. |
| 6 | Özel günler elle | **Hazır Türkiye takvimi** (resmî/millî günler) + **doğum günü / kıdem / hoş geldin** otomatiği (İK CSV yüklemesi) | İK'nın yılda bir kez yaptığı iş; sonrası kendiliğinden döner. |
| 7 | Acil yayına "dual approval" | **Önceden onaylı acil şablonları** + basılı tutarak onay (3 sn) + otomatik denetim kaydı | Gerçek yangında ikinci onay beklemek can kaybettirir. Suistimal; rol, kayıt ve hız sınırı ile engellenir. |
| 8 | Sunum sırasında rahatsız edebilir | **Rahatsız etme kuralları** (ErtePals'tan): tam ekran sunum/oyun/video varken rozet ve kart bekler; **acil durum hariç** | Toplantıda yansıtılan ekrana "doğum günü" kartı düşmesin. |
| 9 | Lisans/anti-RE ağırlıklı | Önce **ürün değeri**; lisans imzalı dosya ile Faz 3'e | Satış öncesi asıl risk, kullanılmayan üründür. |

---

## 1. Kim ne yapar? (Rol bazlı kullanım)

### İK
- Hazır şablondan duyuru: *Servis güzergâhı değişti*, *Bayram tatili*, *Yemek menüsü*, *Eğitim daveti*, *Yeni arkadaşımız*.
- **Mikro anket**: tek soru, 2–5 seçenek; sonuç anlık grafik.
- **Kutlamalar**: çalışan listesini (kullanıcı adı, ad soyad, doğum günü gün/ay, işe giriş tarihi, departman, lokasyon) CSV ile yükler → sistem her sabah ilgili kişinin ekranına kişisel kart gösterir.
- Okunma oranı raporu: "Duyuruyu 412 kişiden 388'i gördü, 301'i okudum dedi."

### İSG
- **Acil Durum** sayfası: büyük butonlar → *Yangın*, *Deprem*, *Tahliye*, *Gaz kaçağı*, *Kimyasal sızıntı*, *Serbest metin*. Basılı tut → tüm ekranlar kırmızı, sesli.
- **Yoklama (Roll-call)**: tam ekranda iki büyük buton → **Güvendeyim** / **Yardım lazım**. Panelde lokasyon bazlı canlı sayaç: güvende · yardım · yanıt yok. "Yardım lazım" diyen cihazın hostname + kullanıcı + lokasyonu en üstte kırmızı listelenir.
- **Tatbikat modu**: aynı akış, ekranda büyük "TATBİKAT" etiketi; rapor tatbikat tutanağı olarak dışa aktarılır (süre, yanıt oranı).
- **Zorunlu okuma**: İSG talimatı → "Okudum, anladım" onayı (kim/ne zaman) → denetim kanıtı. Opsiyonel tek soruluk kontrol sorusu.

### IT
- **Cihazlar**: hostname, IP, MAC, işletim sistemi, CPU, RAM, disk doluluk, açık kalma süresi, son görülme, ajan sürümü. Filtre + CSV dışa aktarım.
- **Otomatik uyarılar**: disk ≥ %90, 14+ gün yeniden başlatılmamış, 7+ gündür görünmeyen cihaz, eski ajan sürümü.
- **Bakım geri sayımı**: "18:00'de sunucu bakımı" → üst şeritte geri sayım.
- **Siber olay yayını**: "Ağ kablonuzu çekin" acil şablonu.
- **IT'ye bildir kutusu**: çalışan tepsiden bildirir; cihaz özeti otomatik eklenir (helpdesk-lite).
- Cihaz onayı, etiketleme (lokasyon/departman), ajan kayıt anahtarı üretimi.

---

## 2. Mimari (sadeleştirilmiş)

```
┌──────────────────────── İÇ AĞ ────────────────────────────┐
│                                                            │
│  Tarayıcı (İK/İSG/IT) ──HTTPS──►  ErtePano Sunucu          │
│  Kiosk TV ─────────────HTTPS──►   (Node + Fastify)         │
│                                    ├─ REST /api/*          │
│                                    ├─ WebSocket /ws/agent  │
│                                    ├─ Panel (statik React) │
│                                    ├─ Zamanlayıcı (özel    │
│                                    │   gün, kutlama, purge)│
│                                    ├─ SQLite (WAL) / PG    │
│                                    └─ data/media (görsel)  │
│                                        ▲                   │
│                  WSS + cihaz anahtarı + Ed25519 imza       │
│          ┌────────────┬───────────────┴──┬─────────┐       │
│        Ajan         Ajan              Ajan      Ajan       │
│   (Tauri v2, ~20 MB RAM, tepside, oturum açılışında)       │
└────────────────────────────────────────────────────────────┘
               ⛔ İnternete veri çıkışı yok ⛔
```

### Ölçek kararları
| Cihaz sayısı | Önerilen kurulum |
|---|---|
| ≤ 3.000 | Tek sunucu, SQLite, `npm start` veya Windows Service (nssm) |
| 3.000–20.000 | PostgreSQL + aynı Node sunucusu (Prisma/Drizzle ile geçiş), reverse proxy |
| 20.000+ | Birden çok Node + Redis pub/sub + yük dengeleyici |

---

## 3. Masaüstü Ajanı

ErtePals'ın sahne (stage) motorundan alınanlar: **monitör başına tek şeffaf pencere**, `WS_EX_TRANSPARENT | WS_EX_LAYERED` ile click-through, `WS_EX_NOACTIVATE` ile odak çalmama, `HWND_TOPMOST` tekrar iddiası, tam ekran uygulama algılama (`SHQueryUserNotificationState`), boşta kalma algılama.

### 3.1 Gösterim türleri
| Tür | Görünüm | Etkileşim | Rahatsız etme kuralı |
|---|---|---|---|
| **Rozet** | Köşede 120 px görsel (bayrak, logo) | Click-through, üzerine gelince opaklaşır | Tam ekranda gizlenir |
| **Kart** | Sağ altta kart | Okudum / Kapat | Tam ekranda bekler, sonra gösterilir |
| **Şerit** | Üstte ince bant | Kapat | Tam ekranda bekler |
| **Anket** | Sağ altta kart + seçenekler | Tek tık oy | Tam ekranda bekler |
| **Geri sayım** | Üst şerit + sayaç | Kapatılabilir, son 5 dk tekrar açılır | Her zaman |
| **Acil (tam ekran)** | Tüm monitörler kırmızı, ses | Güvendeyim / Yardım lazım | **Hiçbir kural engellemez** |

### 3.2 Tepsi menüsü (çalışana değer)
- 📋 Duyurularım (son 20 duyuru)
- 🛠️ IT'ye bildir (kısa metin + otomatik cihaz özeti)
- ℹ️ Bu yazılım ne topluyor? (aydınlatma metni — şeffaflık)

### 3.3 Güvenlik
- **Kayıt:** Kurulumda verilen *kayıt anahtarı* → sunucu cihaz kimliği + cihaz sırrı döner. IT onaylayana kadar cihaz "beklemede".
- **Komut imzası:** Her duyuru sunucunun **Ed25519** özel anahtarıyla imzalanır. Ajan, kurulum yapılandırmasındaki (`agent.json`) **sabitlenmiş genel anahtar** ile doğrulamadan hiçbir şey göstermez. Sahte sunucu/sahte duyuru → gösterilmez.
- **Tazelik:** İmzalı yükte `issuedAt` / `expiresAt`; eski acil mesajının tekrar oynatılması (replay) engellenir.
- **Taşıma:** Üretimde WSS (iç CA). mTLS Faz 2.
- **Kapatılamazlık:** Rootkit yok. Faz 1: oturum açılışında başlar, kapanırsa zamanlanmış görev yeniden açar. Faz 2: Windows Service + kullanıcı oturumunda UI yardımcı süreci.
- **Çevrimdışı:** Aktif duyurular yerel önbellekte; bağlantı yokken de planlı rozet/kart gösterilir. Onaylar kuyrukta bekler.

### 3.4 Toplanan veri (KVKK — değişmedi, netleştirildi)
✅ Hostname, IP, MAC, oturum kullanıcı adı, OS, CPU modeli/yükü, RAM, disk, uptime, ajan sürümü.
⛔ Ekran görüntüsü, pencere başlığı, klavye/fare, tarayıcı geçmişi, dosya, kamera/mikrofon — **kodda yok, eklenemez**.
Tepsideki "Bu yazılım ne topluyor?" ekranı bu listeyi çalışana gösterir.

---

## 4. Veri modeli (uygulanan)

```
users            panel kullanıcıları (rol: admin | it | isg | ik | viewer)
devices          cihazlar + etiketler (lokasyon, departman) + son telemetri
telemetry        zaman serisi (retention: 30 gün)
announcements    tür, kategori (ik|isg|it|genel), içerik, hedef, zaman, zorunlu onay, anket seçenekleri
deliveries       duyuru × cihaz: gönderildi / görüldü / okudu / onayladı / yanıt
emergencies      acil olay (tür, tatbikat mı, başlatan, bitiş)
roll_calls       acil olay × cihaz: güvende / yardım / yanıt yok + kullanıcı + zaman
reports          çalışan bildirimleri: it_help (+ cihaz özeti, durum)
employees        İK listesi (doğum günü gün/ay, işe giriş) — kutlama otomasyonu
special_days     takvim (sabit tarih, yıllık tekrar), rozet görseli
enroll_keys      ajan kayıt anahtarları
audit_log        kim, ne zaman, ne yaptı (silinemez)
settings         sunucu anahtarları, kiosk anahtarı vb.
```

**Saklama:** telemetri 30 gün, teslim kayıtları 1 yıl, acil/yoklama + zorunlu onay 2 yıl (politika ile değiştirilebilir), denetim kaydı 2 yıl. Gece purge görevi.

---

## 5. Kolaylık ilkeleri (UX)

1. **Şablonla başla:** Boş form yok; her kategori için hazır şablon, tek tıkla doldurulur.
2. **Canlı önizleme:** Yazarken sağda ekranda nasıl görüneceği görünür.
3. **Hedef seçimi tek satır:** "Herkes" · lokasyon çipleri · departman çipleri. Kaç cihaza gideceği anında yazar.
4. **Acil sayfası tek ekran:** Büyük renkli butonlar, basılı tut, bitti. Yoklama aynı sayfada canlı.
5. **Okunma oranı her duyurunun yanında** bir ilerleme çubuğu.
6. **Rahatsız etmeme varsayılan:** Kutlama kartları sabah oturum açılışında, toplantı ortasında değil.
7. **Türkçe, sade dil:** "Telemetri" yerine "Cihaz durumu", "Acknowledge" yerine "Okudum".

---

## 6. API (uygulanan sürüm)

Ajan:
```
POST /api/agent/enroll            kayıt anahtarı → cihaz kimliği + sır
WSS  /ws/agent                    hello · telemetry · ack · safety · report  ⇄  welcome · sync · show · revoke
GET  /api/agent/announcements     (yedek çekme, imzalı)
```
Panel (oturum çerezi + rol):
```
POST /api/auth/login | /logout      GET /api/auth/me
GET  /api/dashboard
GET/POST/PATCH/DELETE /api/announcements[/:id]   POST /api/announcements/:id/end
GET  /api/announcements/:id/report
GET  /api/templates
POST /api/emergencies   GET /api/emergencies/active   POST /api/emergencies/:id/end   GET /api/emergencies/:id
GET  /api/devices   PATCH /api/devices/:id   POST /api/devices/:id/approve   GET /api/devices.csv
GET/POST /api/enroll-keys
GET/PATCH /api/reports
GET/POST/DELETE /api/special-days
GET/POST /api/employees (CSV)
GET/POST/PATCH /api/users
GET  /api/audit
GET  /api/kiosk?key=…               (TV ekranı için salt-okur)
POST /api/media                      görsel yükleme
```

---

## 7. Yol haritası (revize)

| Faz | Süre | Çıktı |
|---|---|---|
| **0 — Bu depo** | ✔ | Sunucu, panel, simülatör, Tauri ajan çekirdeği (kart/şerit/rozet/acil/anket/geri sayım, imza doğrulama, telemetri, tepsi) |
| **1 — Pilot** | 3–4 hafta | Tek departmanda pilot, MSI + GPO dağıtım, iç CA ile HTTPS, AD/LDAP girişi, Windows Service |
| **2 — Kurumsal** | 4–6 hafta | mTLS, PostgreSQL seçeneği, imzalı otomatik güncelleme, tatbikat tutanağı PDF, Teams/e-posta yedek kanalı, çoklu dil |
| **3 — Ürünleşme** | sürekli | İmzalı + donanıma bağlı lisans, çoklu kurum, SIEM/Zabbix webhook, HA |

---

## 8. Riskler (eklenenler)

| Risk | Önlem |
|---|---|
| Duyuru yorgunluğu (çok bildirim → kimse okumaz) | Kategori başına günlük sınır, rahatsız etmeme kuralları, okunma oranı raporu |
| Acil yayının yanlışlıkla tetiklenmesi | Basılı tutarak onay, tatbikat ayrımı, 1 tıkla "Yanlış alarm — iptal" yayını |
| Yoklamada PC başında olmayan çalışan | Yoklama raporu "yanıt yok" listesi → toplanma alanı sorumlusuna; kiosk ekranında da gösterim |
| Doğum günü verisi (KVKK) | Sadece gün/ay, açık rıza ile; çalışan tepsiden kapatabilir |

---

*v1 dokümanındaki güvenlik, lisans ve hukuki bölümler geçerliliğini korur; bu v2 ürün kapsamını, sadeliği ve uygulanabilirliği öne çeker.*
